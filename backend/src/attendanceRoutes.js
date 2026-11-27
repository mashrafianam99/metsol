// Class attendance: teachers mark their own department's students per course and date;
// admins can do it for every department; students read their own per-course summary.
import express from 'express';

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE'];
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

export function parseClassDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text(value));
  if (!match) return null;
  const date = new Date(`${match[0]}T00:00:00.000Z`);
  return date.getUTCDate() === Number(match[3]) ? date : null;
}

export function normalizeAttendanceSave(body) {
  const courseId = text(body?.courseId);
  if (!courseId) return { error: 'Choose a course.' };
  const date = parseClassDate(body?.date);
  if (!date) return { error: 'Choose a valid class date.' };
  const records = Array.isArray(body?.records) ? body.records : [];
  if (!records.length || records.length > MAX_RECORDS) return { error: `Mark at least one student (up to ${MAX_RECORDS}).` };
  const seen = new Set();
  for (const record of records) {
    if (!ATTENDANCE_STATUSES.includes(record?.status)) return { error: 'Each student must be Present, Absent or Late.' };
    const studentId = text(record.studentId);
    if (!studentId || seen.has(studentId)) return { error: 'Each student can only be marked once.' };
    seen.add(studentId);
  }
  return { value: { courseId, date, records: records.map((record) => ({ studentId: text(record.studentId), status: record.status })) } };
}

export function summarizeAttendance(rows, courses) {
  return courses.map((course) => {
    const mine = rows.filter((row) => row.courseId === course.id);
    const count = (status) => mine.filter((row) => row.status === status).length;
    const [present, late, absent] = [count('PRESENT'), count('LATE'), count('ABSENT')];
    const total = mine.length;
    return { courseId: course.id, code: course.code, title: course.title, present, late, absent, total, percent: total ? Math.round(((present + late) / total) * 100) : 0 };
  });
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
    const date = parseClassDate(req.query.date);
    if (!date) throw fail(400, 'Choose a valid class date.');
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
    const marked = await db.attendance.findMany({ where: { courseId: course.id, date, studentId: { in: students.map((student) => student.id) } }, select: { studentId: true, status: true } });
    const status = new Map(marked.map((row) => [row.studentId, row.status]));
    res.json({ course, students: students.map((student) => ({ ...student, status: status.get(student.id) || null })) });
  }));

  router.put('/attendance', ...staff, wrap(async (req, res) => {
    const parsed = normalizeAttendanceSave(req.body);
    if (parsed.error) throw fail(400, parsed.error);
    const { courseId, date, records } = parsed.value;
    const course = await courseFor(req.user, courseId);
    const ids = records.map((record) => record.studentId);
    const allowed = await db.user.count({ where: { id: { in: ids }, ...rosterWhere(course) } });
    if (allowed !== ids.length) throw fail(403, "Some of these students aren't in this course's department.");
    // shortcut: no unique (student, course, date) constraint in the schema, so replace that day's rows in one transaction.
    await db.$transaction([
      db.attendance.deleteMany({ where: { courseId, date, studentId: { in: ids } } }),
      db.attendance.createMany({ data: records.map((record) => ({ ...record, courseId, date })) }),
    ]);
    res.json({ saved: records.length });
  }));

  router.get('/attendance/me', auth, wrap(async (req, res) => {
    const rows = await db.attendance.findMany({ where: { studentId: req.user.id }, select: { courseId: true, status: true } });
    const courses = await db.course.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.courseId))] } }, select: { id: true, code: true, title: true }, orderBy: { code: 'asc' } });
    res.json(summarizeAttendance(rows, courses));
  }));

  return router;
}
