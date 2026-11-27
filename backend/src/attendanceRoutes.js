// Official course attendance: teachers set one percentage per student per course for their own
// department's students; admins can do it for every department; students read their own.
import express from 'express';

const MAX_RECORDS = 500;
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const fail = (status, message) => Object.assign(new Error(message), { status });
const insensitive = (value) => ({ equals: value, mode: 'insensitive' });

// Prisma filter limiting students/courses to what this user may see.
export function departmentScope(user) {
  if (user.role === 'ADMIN') return {};
  const department = text(user.department);
  if (!department) throw fail(403, 'Your teacher account has no department yet. Ask an administrator to set it.');
  return { department: insensitive(department) };
}

const toPercent = (value) => {
  if (value === null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 100 ? number : null;
};

export function normalizeAttendanceSave(body) {
  const courseId = text(body?.courseId);
  if (!courseId) return { error: 'Choose a course.' };
  const records = Array.isArray(body?.records) ? body.records : [];
  if (!records.length || records.length > MAX_RECORDS) return { error: `Enter attendance for at least one student (up to ${MAX_RECORDS}).` };
  const seen = new Set();
  const value = [];
  for (const record of records) {
    const percent = toPercent(record?.percent);
    if (percent === null) return { error: 'Attendance must be a whole number from 0 to 100.' };
    const studentId = text(record.studentId);
    if (!studentId || seen.has(studentId)) return { error: 'Each student can only be entered once.' };
    seen.add(studentId);
    value.push({ studentId, percent });
  }
  return { value: { courseId, records: value } };
}

export function summarizeAttendance(rows, courses) {
  const byCourse = new Map(rows.map((row) => [row.courseId, row]));
  return courses
    .filter((course) => byCourse.has(course.id))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((course) => ({ courseId: course.id, code: course.code, title: course.title, percent: byCourse.get(course.id).percent, updatedAt: byCourse.get(course.id).updatedAt }));
}

export function createAttendanceRouter({ db, auth, roles }) {
  const router = express.Router();
  const staff = [auth, roles('ADMIN', 'TEACHER')];
  const wrap = (handler) => async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error?.status) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  };

  async function courseFor(user, courseId) {
    const course = await db.course.findFirst({ where: { id: courseId, ...departmentScope(user) }, select: { id: true, code: true, title: true, department: true } });
    if (!course) throw fail(404, 'Course not found in your department.');
    return course;
  }
  // Students who belong to the course's department (all students for an admin on a department-less course).
  const rosterWhere = (course) => ({ role: 'STUDENT', isActive: true, ...(course.department ? { department: insensitive(course.department) } : {}) });

  router.get('/attendance/courses', ...staff, wrap(async (req, res) => {
    res.json(await db.course.findMany({ where: departmentScope(req.user), select: { id: true, code: true, title: true, department: true }, orderBy: { code: 'asc' } }));
  }));

  router.get('/attendance/roster', ...staff, wrap(async (req, res) => {
    const course = await courseFor(req.user, text(req.query.courseId));
    const q = text(req.query.q).slice(0, 100);
    const batch = text(req.query.batch).slice(0, 40);
    const section = text(req.query.section).slice(0, 40);
    const students = await db.user.findMany({
      where: {
        ...rosterWhere(course),
        ...(batch ? { batch: insensitive(batch) } : {}),
        ...(section ? { section: insensitive(section) } : {}),
        ...(q ? { OR: ['name', 'studentId', 'email'].map((field) => ({ [field]: { contains: q, mode: 'insensitive' } })) } : {}),
      },
      select: { id: true, name: true, studentId: true, department: true, batch: true, section: true },
      orderBy: [{ batch: 'asc' }, { section: 'asc' }, { studentId: 'asc' }],
      take: MAX_RECORDS,
    });
    const saved = await db.courseAttendance.findMany({ where: { courseId: course.id, studentId: { in: students.map((student) => student.id) } }, select: { studentId: true, percent: true, updatedAt: true } });
    const byStudent = new Map(saved.map((row) => [row.studentId, row]));
    res.json({ course, students: students.map((student) => ({ ...student, percent: byStudent.get(student.id)?.percent ?? null, updatedAt: byStudent.get(student.id)?.updatedAt ?? null })) });
  }));

  router.put('/attendance', ...staff, wrap(async (req, res) => {
    const parsed = normalizeAttendanceSave(req.body);
    if (parsed.error) throw fail(400, parsed.error);
    const { courseId, records } = parsed.value;
    const course = await courseFor(req.user, courseId);
    const ids = records.map((record) => record.studentId);
    const allowed = await db.user.count({ where: { id: { in: ids }, ...rosterWhere(course) } });
    if (allowed !== ids.length) throw fail(403, "Some of these students aren't in this course's department.");
    await db.$transaction(records.map(({ studentId, percent }) => db.courseAttendance.upsert({
      where: { studentId_courseId: { studentId, courseId } },
      create: { studentId, courseId, percent, updatedById: req.user.id },
      update: { percent, updatedById: req.user.id },
    })));
    res.json({ saved: records.length });
  }));

  router.get('/attendance/me', auth, wrap(async (req, res) => {
    const rows = await db.courseAttendance.findMany({ where: { studentId: req.user.id }, select: { courseId: true, percent: true, updatedAt: true } });
    const courses = await db.course.findMany({ where: { id: { in: rows.map((row) => row.courseId) } }, select: { id: true, code: true, title: true } });
    res.json(summarizeAttendance(rows, courses));
  }));

  return router;
}
