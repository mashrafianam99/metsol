import test from 'node:test';
import assert from 'node:assert/strict';
import { departmentScope, normalizeAttendanceSave, parseClassDate, summarizeAttendance } from '../src/attendanceRoutes.js';

test('teachers are limited to their own department, matched ignoring case; admins see all', () => {
  assert.deepEqual(departmentScope({ role: 'TEACHER', department: ' CSE ' }), { department: { equals: 'CSE', mode: 'insensitive' } });
  assert.deepEqual(departmentScope({ role: 'ADMIN', department: null }), {});
  assert.throws(() => departmentScope({ role: 'TEACHER', department: '' }), (error) => error.status === 403 && /no department/.test(error.message));
});

test('class dates must be real YYYY-MM-DD dates and are stored as UTC midnight', () => {
  assert.equal(parseClassDate('2026-11-28').toISOString(), '2026-11-28T00:00:00.000Z');
  assert.equal(parseClassDate('2026-02-30'), null);
  assert.equal(parseClassDate('28/11/2026'), null);
  assert.equal(parseClassDate(undefined), null);
});

test('saving attendance needs a course, a date and known statuses, one entry per student', () => {
  const ok = normalizeAttendanceSave({ courseId: 'c1', date: '2026-11-28', records: [{ studentId: 's1', status: 'PRESENT' }, { studentId: 's2', status: 'LATE' }] });
  assert.equal(ok.error, undefined);
  assert.equal(ok.value.records.length, 2);
  assert.match(normalizeAttendanceSave({ date: '2026-11-28', records: [] }).error, /course/);
  assert.match(normalizeAttendanceSave({ courseId: 'c1', date: 'today', records: [] }).error, /date/);
  assert.match(normalizeAttendanceSave({ courseId: 'c1', date: '2026-11-28', records: [] }).error, /at least one/);
  assert.match(normalizeAttendanceSave({ courseId: 'c1', date: '2026-11-28', records: [{ studentId: 's1', status: 'MAYBE' }] }).error, /Present, Absent or Late/);
  assert.match(normalizeAttendanceSave({ courseId: 'c1', date: '2026-11-28', records: [{ studentId: 's1', status: 'PRESENT' }, { studentId: 's1', status: 'ABSENT' }] }).error, /once/);
});

test('attendance summary counts late as attended and rounds the percentage', () => {
  const rows = [
    { courseId: 'c1', status: 'PRESENT' }, { courseId: 'c1', status: 'LATE' }, { courseId: 'c1', status: 'ABSENT' },
    { courseId: 'c2', status: 'ABSENT' },
  ];
  const courses = [{ id: 'c1', code: 'CSE301', title: 'Database Systems' }, { id: 'c2', code: 'CSE302', title: 'AI' }];
  assert.deepEqual(summarizeAttendance(rows, courses), [
    { courseId: 'c1', code: 'CSE301', title: 'Database Systems', present: 1, late: 1, absent: 1, total: 3, percent: 67 },
    { courseId: 'c2', code: 'CSE302', title: 'AI', present: 0, late: 0, absent: 1, total: 1, percent: 0 },
  ]);
});
