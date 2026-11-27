import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInvoiceFields, normalizeNewUser, normalizeNotice, normalizeUserUpdate } from '../src/adminRoutes.js';

test('new accounts need a name, valid email, 8+ character password and a role', () => {
  const ok = normalizeNewUser({ name: ' Rahim ', email: ' Rahim@Example.EDU ', password: 'longenough', role: 'TEACHER' });
  assert.equal(ok.error, undefined);
  assert.equal(ok.value.name, 'Rahim');
  assert.equal(ok.value.email, 'rahim@example.edu');
  assert.equal(normalizeNewUser({ name: 'A', email: 'bad', password: 'longenough', role: 'TEACHER' }).error, 'Enter a valid email address.');
  assert.match(normalizeNewUser({ name: 'A', email: 'a@b.co', password: 'short', role: 'TEACHER' }).error, /8 characters/);
  assert.equal(normalizeNewUser({ name: 'A', email: 'a@b.co', password: 'longenough', role: 'ROOT' }).error, 'Choose a role.');
});

test('student accounts require a student ID, which is upper-cased', () => {
  assert.match(normalizeNewUser({ name: 'S', email: 's@b.co', password: 'longenough', role: 'STUDENT' }).error, /student ID/);
  const ok = normalizeNewUser({ name: 'S', email: 's@b.co', password: 'longenough', role: 'STUDENT', studentId: ' 241-cse-01 ', batch: '60' });
  assert.equal(ok.value.studentId, '241-CSE-01');
  assert.equal(ok.value.batch, '60');
  assert.equal(ok.value.department, null);
});

test('account updates only accept known roles and boolean status', () => {
  assert.deepEqual(normalizeUserUpdate({ role: 'ADMIN', isActive: false }).value, { role: 'ADMIN', isActive: false });
  assert.equal(normalizeUserUpdate({ role: 'OWNER' }).error, 'Choose a valid role.');
  assert.equal(normalizeUserUpdate({ isActive: 'no' }).error, 'Active must be true or false.');
  assert.equal(normalizeUserUpdate({}).error, 'Nothing to update.');
});

test('notices validate audience and category and default to notifying', () => {
  const ok = normalizeNotice({ title: ' Exam ', body: ' Room 301 ', audience: 'STUDENT', category: 'EXAM' });
  assert.deepEqual(ok.value, { title: 'Exam', body: 'Room 301', audience: 'STUDENT', category: 'EXAM' });
  assert.equal(ok.notify, true);
  assert.equal(normalizeNotice({ title: 'x', body: 'y', notify: false }).notify, false);
  assert.match(normalizeNotice({ title: 'x', body: 'y', audience: 'PARENTS' }).error, /who should see/);
  assert.match(normalizeNotice({ title: 'x', body: 'y', category: 'GOSSIP' }).error, /category/);
  assert.match(normalizeNotice({ title: '', body: 'y' }).error, /title/);
});

test('invoice fields need a fee type and a positive amount with at most 2 decimals', () => {
  const ok = normalizeInvoiceFields({ feeType: 'Lab Fee', amount: 1500.5, dueDate: '2026-12-10' });
  assert.equal(ok.value.amount, '1500.50');
  assert.ok(ok.value.dueDate instanceof Date);
  assert.match(normalizeInvoiceFields({ feeType: 'x', amount: 0 }).error, /amount/);
  assert.match(normalizeInvoiceFields({ feeType: 'x', amount: 1.234 }).error, /2 decimals/);
  assert.match(normalizeInvoiceFields({ feeType: '', amount: 10 }).error, /Fee type/);
  assert.match(normalizeInvoiceFields({ feeType: 'x', amount: 10, dueDate: 'soon' }).error, /Due date/);
});
