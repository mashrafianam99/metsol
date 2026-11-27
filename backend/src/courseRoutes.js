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

  return router;
}
