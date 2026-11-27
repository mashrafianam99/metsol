import test from 'node:test';
import assert from 'node:assert/strict';
import { departmentScope, normalizeAttendanceSave, summarizeAttendance } from '../src/attendanceRoutes.js';

test('teachers are limited to their own department, matched ignoring case; admins see all', () => {
  assert.deepEqual(departmentScope({ role: 'TEACHER', department: ' CSE ' }), { department: { equals: 'CSE', mode: 'insensitive' } });
  assert.deepEqual(departmentScope({ role: 'ADMIN', department: null }), {});
  assert.throws(() => departmentScope({ role: 'TEACHER', department: '' }), (error) => error.status === 403 && /no department/.test(error.message));
});

test('saving attendance needs a course and a whole-number percentage from 0 to 100 per student', () => {
  const ok = normalizeAttendanceSave({ courseId: 'c1', records: [{ studentId: 's1', percent: 85 }, { studentId: 's2', percent: '0' }] });
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.value.records, [{ studentId: 's1', percent: 85 }, { studentId: 's2', percent: 0 }]);
  assert.match(normalizeAttendanceSave({ records: [{ studentId: 's1', percent: 50 }] }).error, /course/);
  assert.match(normalizeAttendanceSave({ courseId: 'c1', records: [] }).error, /at least one/);
  for (const bad of [101, -1, 72.5, '', 'abc', null]) {
    assert.match(normalizeAttendanceSave({ courseId: 'c1', records: [{ studentId: 's1', percent: bad }] }).error, /0 to 100/, `percent ${bad}`);
  }
  assert.match(normalizeAttendanceSave({ courseId: 'c1', records: [{ studentId: 's1', percent: 1 }, { studentId: 's1', percent: 2 }] }).error, /once/);
});

test('a student summary lists each course that has a percentage, in course-code order', () => {
  const rows = [{ courseId: 'c2', percent: 64, updatedAt: 'd2' }, { courseId: 'c1', percent: 90, updatedAt: 'd1' }];
  const courses = [{ id: 'c1', code: 'CSE301', title: 'Database Systems' }, { id: 'c2', code: 'CSE302', title: 'AI' }];
  assert.deepEqual(summarizeAttendance(rows, courses), [
    { courseId: 'c1', code: 'CSE301', title: 'Database Systems', percent: 90, updatedAt: 'd1' },
    { courseId: 'c2', code: 'CSE302', title: 'AI', percent: 64, updatedAt: 'd2' },
  ]);
});
