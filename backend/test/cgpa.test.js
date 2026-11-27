import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCgpa, calculateResultSummary } from '../../shared/grading.js';
import { buildCgpaSummary, compareTerms } from '../src/result-import/cgpa.js';

const course = (semester, grade, gradePoint, credits = 3, extra = {}) => ({ semester, academicYear: null, grade, gradePoint, credits, gpa: null, cgpa: null, ...extra });

test('calculateCgpa combines the previous record with new courses', () => {
  // 60 credits at 3.50 = 210 points; new semester 15 credits at 4.00 = 60 points -> 270 / 75 = 3.60
  assert.equal(calculateCgpa({ previousCgpa: 3.5, previousCredits: 60, qualityPoints: 60, gpaCredits: 15 }).toFixed(2), '3.60');
  // first semester: CGPA equals the semester GPA
  assert.equal(calculateCgpa({ qualityPoints: 45, gpaCredits: 12 }).toFixed(2), '3.75');
  assert.equal(calculateCgpa({}), 0);
});

test('result summary reports the credits that count towards CGPA', () => {
  const summary = calculateResultSummary([course('Spring 2025', 'A+', 4), course('Spring 2025', 'W', 0)]);
  assert.equal(summary.attemptedCredits, 6);
  assert.equal(summary.gpaCredits, 3);
});

test('terms are ordered by year, then Spring, Summer, Fall', () => {
  const terms = ['Fall 2024', 'Summer 2025', 'Spring 2025', 'Spring 2024'].map((semester) => ({ semester }));
  assert.deepEqual(terms.sort(compareTerms).map((term) => term.semester), ['Spring 2024', 'Fall 2024', 'Spring 2025', 'Summer 2025']);
  const numbered = ['Semester 3', 'Semester 1', 'Semester 2'].map((semester) => ({ semester }));
  assert.deepEqual(numbered.sort(compareTerms).map((term) => term.semester), ['Semester 1', 'Semester 2', 'Semester 3']);
});

test('CGPA is cumulative across terms in chronological order', () => {
  const records = [
    course('Spring 2025', 'B', 3),     // later term listed first on purpose
    course('Spring 2025', 'B', 3),
    course('Fall 2024', 'A+', 4),
    course('Fall 2024', 'A+', 4),
  ];
  const result = buildCgpaSummary(records);
  assert.deepEqual(result.semesters.map((term) => term.semester), ['Fall 2024', 'Spring 2025']);
  assert.equal(result.semesters[0].gpa, 4);
  assert.equal(result.semesters[0].cgpa, 4);
  assert.equal(result.semesters[1].gpa, 3);
  assert.equal(result.semesters[1].cgpa, 3.5);
  assert.equal(result.cgpa, 3.5);
  assert.equal(result.cgpaSource, 'calculated');
});

test("the university's own CGPA wins when the PDF reports one", () => {
  const records = [course('Fall 2024', 'A', 3.75, 3, { cgpa: 3.81, gpa: 3.75 })];
  const result = buildCgpaSummary(records);
  assert.equal(result.cgpa, 3.81);
  assert.equal(result.cgpaSource, 'university');
  assert.equal(result.semesters[0].gpa, 3.75);
});

test('no records gives no CGPA', () => {
  assert.deepEqual(buildCgpaSummary([]), { semesters: [], cgpa: null, cgpaSource: null });
});
