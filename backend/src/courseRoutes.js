// Course catalogue managed by administrators. Teachers take attendance against these courses.
import express from 'express';

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const fail = (status, message) => Object.assign(new Error(message), { status });
const courseSelect = { id: true, code: true, title: true, department: true, credits: true };

export function normalizeCourse(body, { partial = false } = {}) {
  const value = {};
  const has = (key) => !partial || (body && key in body);
  if (has('code')) {
    value.code = text(body?.code).toUpperCase().replace(/\s+/gu, '');
    if (!/^[A-Z0-9-]{2,20}$/u.test(value.code)) return { error: 'Enter a course code (letters, numbers or -, up to 20).' };
  }
  if (has('title')) {
    value.title = text(body?.title);
    if (!value.title || value.title.length > 120) return { error: 'Enter a course title (up to 120 characters).' };
  }
  if (has('department')) {
    value.department = text(body?.department).toUpperCase();
    if (!value.department || value.department.length > 40) return { error: 'Enter a department (e.g. CSE, ENG, BBA).' };
  }
  if (partial ? body && 'credits' in body : true) {
    const credits = body?.credits === undefined || body?.credits === '' ? 3 : Number(body.credits);
    if (!Number.isInteger(credits) || credits < 0 || credits > 6) return { error: 'Credits must be a whole number from 0 to 6.' };
    value.credits = credits;
  }
  if (!Object.keys(value).length) return { error: 'Nothing to update.' };
  return { value };
}

export function normalizeBatchAssignment(body) {
  const courseId = text(body?.courseId);
  const batch = text(body?.batch);
  if (!courseId) return { error: 'Choose a course.' };
  if (!batch || batch.length > 40) return { error: 'Enter the batch (e.g. 60).' };
  return { value: { courseId, batch } };
}

const insensitive = (value) => ({ equals: value, mode: 'insensitive' });
// Students enrolled through a batch assignment: same batch and same department as the course.
const batchStudentsWhere = (course, batch) => ({
  role: 'STUDENT', isActive: true, batch: insensitive(batch), ...(course.department ? { department: insensitive(course.department) } : {}),
});

export function createCourseRouter({ db, auth, roles }) {
  const router = express.Router();
  const admin = [auth, roles('ADMIN')];
  const wrap = (handler) => async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error?.status) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  };
  // The schema has no unique index on code, so duplicates are checked here.
  async function assertCodeFree(code, exceptId) {
    if (!code) return;
    const clash = await db.course.findFirst({ where: { code: { equals: code, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } });
    if (clash) throw fail(409, `A course with code ${code} already exists.`);
  }

  router.get('/admin/courses', ...admin, wrap(async (_req, res) => {
    res.json(await db.course.findMany({ select: courseSelect, orderBy: [{ department: 'asc' }, { code: 'asc' }] }));
  }));

  router.post('/admin/courses', ...admin, wrap(async (req, res) => {
    const parsed = normalizeCourse(req.body);
    if (parsed.error) throw fail(400, parsed.error);
    await assertCodeFree(parsed.value.code);
    res.status(201).json(await db.course.create({ data: parsed.value, select: courseSelect }));
  }));

  router.patch('/admin/courses/:id', ...admin, wrap(async (req, res) => {
    const parsed = normalizeCourse(req.body, { partial: true });
    if (parsed.error) throw fail(400, parsed.error);
    await assertCodeFree(parsed.value.code, req.params.id);
    try {
      res.json(await db.course.update({ where: { id: req.params.id }, data: parsed.value, select: courseSelect }));
    } catch (error) {
      if (error?.code === 'P2025') throw fail(404, 'Course not found.');
      throw error;
    }
  }));

  // ---------- Batch assignments ----------
  router.get('/admin/course-batches', ...admin, wrap(async (_req, res) => {
    const rows = await db.courseBatch.findMany({ orderBy: [{ batch: 'asc' }, { createdAt: 'asc' }] });
    const courses = await db.course.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.courseId))] } }, select: courseSelect });
    const byId = new Map(courses.map((course) => [course.id, course]));
    const withCounts = await Promise.all(rows.filter((row) => byId.has(row.courseId)).map(async (row) => {
      const course = byId.get(row.courseId);
      return { id: row.id, batch: row.batch, createdAt: row.createdAt, course, studentCount: await db.user.count({ where: batchStudentsWhere(course, row.batch) }) };
    }));
    res.json(withCounts);
  }));

  router.post('/admin/course-batches', ...admin, wrap(async (req, res) => {
    const parsed = normalizeBatchAssignment(req.body);
    if (parsed.error) throw fail(400, parsed.error);
    const course = await db.course.findUnique({ where: { id: parsed.value.courseId }, select: courseSelect });
    if (!course) throw fail(404, 'Course not found.');
    const existing = await db.courseBatch.findFirst({ where: { courseId: course.id, batch: insensitive(parsed.value.batch) }, select: { id: true } });
    if (existing) throw fail(409, `${course.code} is already assigned to batch ${parsed.value.batch}.`);
    const row = await db.courseBatch.create({ data: { courseId: course.id, batch: parsed.value.batch } });
    res.status(201).json({ id: row.id, batch: row.batch, createdAt: row.createdAt, course, studentCount: await db.user.count({ where: batchStudentsWhere(course, row.batch) }) });
  }));

  router.delete('/admin/course-batches/:id', ...admin, wrap(async (req, res) => {
    const { count } = await db.courseBatch.deleteMany({ where: { id: req.params.id } });
    if (!count) throw fail(404, 'Assignment not found.');
    res.status(204).end();
  }));

  // The signed-in student's courses: every course assigned to their batch in their department.
  router.get('/my/courses', auth, wrap(async (req, res) => {
    const { role, batch, department } = req.user;
    if (role !== 'STUDENT' || !batch) return res.json([]);
    const rows = await db.courseBatch.findMany({ where: { batch: insensitive(batch) }, select: { courseId: true } });
    res.json(await db.course.findMany({
      where: { id: { in: rows.map((row) => row.courseId) }, ...(department ? { OR: [{ department: insensitive(department) }, { department: null }] } : {}) },
      select: courseSelect,
      orderBy: { code: 'asc' },
    }));
  }));

  return router;
}
