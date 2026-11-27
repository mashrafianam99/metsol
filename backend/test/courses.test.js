import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBatchAssignment, normalizeCourse } from '../src/courseRoutes.js';

test('assigning a course to a batch needs a course and a batch; the batch is trimmed', () => {
  assert.deepEqual(normalizeBatchAssignment({ courseId: ' c1 ', batch: ' 60 ' }).value, { courseId: 'c1', batch: '60' });
  assert.match(normalizeBatchAssignment({ batch: '60' }).error, /course/);
  assert.match(normalizeBatchAssignment({ courseId: 'c1', batch: '  ' }).error, /batch/);
  assert.match(normalizeBatchAssignment({ courseId: 'c1', batch: 'x'.repeat(41) }).error, /batch/);
});

test('courses need a code, title and department; code and department are upper-cased', () => {
  const ok = normalizeCourse({ code: ' cse 401 ', title: ' Compiler Design ', department: ' cse ', credits: '3' });
  assert.deepEqual(ok.value, { code: 'CSE401', title: 'Compiler Design', department: 'CSE', credits: 3 });
  assert.match(normalizeCourse({ title: 'x', department: 'CSE' }).error, /course code/);
  assert.match(normalizeCourse({ code: 'CSE1', department: 'CSE' }).error, /title/);
  assert.match(normalizeCourse({ code: 'CSE1', title: 'x' }).error, /department/);
});

test('credits must be a whole number from 0 to 6 and default to 3', () => {
  assert.equal(normalizeCourse({ code: 'A1', title: 'x', department: 'BBA' }).value.credits, 3);
  assert.equal(normalizeCourse({ code: 'A1', title: 'x', department: 'BBA', credits: 1.5 }).error, 'Credits must be a whole number from 0 to 6.');
  assert.equal(normalizeCourse({ code: 'A1', title: 'x', department: 'BBA', credits: 9 }).error, 'Credits must be a whole number from 0 to 6.');
});

test('partial updates only validate the fields sent', () => {
  assert.deepEqual(normalizeCourse({ title: ' New title ' }, { partial: true }).value, { title: 'New title' });
  assert.equal(normalizeCourse({}, { partial: true }).error, 'Nothing to update.');
  assert.match(normalizeCourse({ code: '' }, { partial: true }).error, /course code/);
});
