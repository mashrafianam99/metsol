import assert from "node:assert/strict";
import test from "node:test";
import { extractPdfLines, isPdfBuffer } from "../src/result-import/pdfParser.js";
import { parseResultLines } from "../src/result-import/resultParser.js";
import {
  filterRecordsForStudent,
  getAuthenticatedStudentResultFilter,
} from "../src/result-import/studentResultMatcher.js";
import { calculateResultSummary, getGradeFromScore, getGradePointForGrade } from "../../shared/grading.js";

const header = {
  items: [
    { str: "Student ID", x: 0 },
    { str: "Student Name", x: 80 },
    { str: "Course Code", x: 180 },
    { str: "Course Name", x: 260 },
    { str: "Credit Hours", x: 400 },
    { str: "Grade", x: 470 },
    { str: "Grade Point", x: 520 },
  ],
};

const studentRow = (studentId, studentName, grade, gradePoint) => ({
  items: [
    { str: studentId, x: 0 },
    { str: studentName, x: 80 },
    { str: "CSE310", x: 180 },
    { str: "Algorithms", x: 260 },
    { str: "3", x: 400 },
    { str: grade, x: 470 },
    { str: gradePoint, x: 520 },
  ],
});

test("matches only the logged-in student's result despite whitespace in their ID", () => {
  const { records } = parseResultLines([
    header,
    studentRow("241-115-168", "Student A", "A", "3.75"),
    studentRow("241 - 115 - 169", "Student B", "A-", "3.50"),
    studentRow("241-115-170", "Student C", "B+", "3.25"),
  ]);

  const ownRecords = filterRecordsForStudent(records, "241-\n115-169");
  assert.equal(ownRecords.length, 1);
  assert.equal(ownRecords[0].studentName, "Student B");
  assert.deepEqual(
    getAuthenticatedStudentResultFilter("current-import", "241-115-169"),
    { resultImportId: "current-import", studentIdNormalized: "241-115-169" }
  );
});

test("uses the shared Metropolitan University grade scale at score boundaries", () => {
  assert.deepEqual(getGradeFromScore(84), { grade: "A+", gradePoint: 4 });
  assert.deepEqual(getGradeFromScore(72), { grade: "A-", gradePoint: 3.5 });
  assert.deepEqual(getGradeFromScore(61), { grade: "B", gradePoint: 3 });
  assert.deepEqual(getGradeFromScore(39), { grade: "F", gradePoint: 0 });
  assert.deepEqual(getGradeFromScore(79.995), { grade: "A", gradePoint: 3.75 });
  assert.equal(getGradePointForGrade("I"), 0);
});

test("counts F as attempted but excludes special-grade credits from GPA and earned credits", () => {
  assert.deepEqual(
    calculateResultSummary([
      { credits: 3, grade: "F" },
      { credits: 3, grade: "I" },
      { credits: 3, grade: "A+" },
    ]),
    {
      totalQualityPoints: 12,
      attemptedCredits: 9,
      earnedCredits: 3,
      courseCount: 3,
      gpaCredits: 6,
      semesterGpa: 2,
    }
  );
});

test("derives a missing letter grade from marks and preserves available term and GPA fields", () => {
  const { records } = parseResultLines([
    {
      items: [
        { str: "Student ID", x: 0 },
        { str: "Course Code", x: 80 },
        { str: "Credit", x: 180 },
        { str: "Marks", x: 230 },
        { str: "Semester", x: 280 },
        { str: "Academic Year", x: 390 },
        { str: "GPA", x: 500 },
        { str: "CGPA", x: 550 },
      ],
    },
    {
      items: [
        { str: "241-115-169", x: 0 },
        { str: "CSE320", x: 80 },
        { str: "3", x: 180 },
        { str: "72", x: 230 },
        { str: "Spring", x: 280 },
        { str: "2025-26", x: 390 },
        { str: "3.50", x: 500 },
        { str: "3.70", x: 550 },
      ],
    },
  ]);

  assert.equal(records[0].grade, "A-");
  assert.equal(records[0].gradePoint, 3.5);
  assert.equal(records[0].semester, "Spring");
  assert.equal(records[0].academicYear, "2025-26");
  assert.equal(records[0].gpa, 3.5);
  assert.equal(records[0].cgpa, 3.7);
});

test("rejects layouts that cannot reliably tie a grade to a Student ID", () => {
  assert.throws(
    () => parseResultLines([{ items: [{ str: "Course Grade Credit", x: 0 }] }]),
    { code: "UNSUPPORTED_RESULT_LAYOUT" }
  );
});

test("rejects files without a PDF signature before attempting extraction", async () => {
  const notPdf = Buffer.from("this is not a pdf");
  assert.equal(isPdfBuffer(notPdf), false);
  await assert.rejects(extractPdfLines(notPdf), { code: "INVALID_RESULT_PDF" });
});
