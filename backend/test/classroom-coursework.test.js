import assert from "node:assert/strict";
import test from "node:test";
import { buildStudentCoursework, fetchStudentCoursework, getDueAt, isLabWork } from "../src/classroomCoursework.js";

const NOW = new Date("2026-11-11T12:00:00Z");

const course = { id: "c1", name: "CSE 320 Database", section: "A", alternateLink: "https://classroom.google.com/c/c1" };

function work(overrides = {}) {
  return {
    id: "w1",
    courseId: "c1",
    title: "ER Diagram",
    description: "Draw the ER diagram",
    workType: "ASSIGNMENT",
    state: "PUBLISHED",
    alternateLink: "https://classroom.google.com/c/c1/a/w1",
    dueDate: { year: 2026, month: 11, day: 14 },
    dueTime: { hours: 17, minutes: 59 },
    maxPoints: 10,
    ...overrides,
  };
}

test("combines a UTC due date and time, and returns null without a due date", () => {
  assert.equal(getDueAt(work()).toISOString(), "2026-11-14T17:59:00.000Z");
  assert.equal(getDueAt(work({ dueTime: {} })).toISOString(), "2026-11-14T00:00:00.000Z");
  assert.equal(getDueAt(work({ dueDate: undefined, dueTime: undefined })), null);
});

test("detects lab work from the topic name or the title", () => {
  assert.equal(isLabWork({ title: "Report" }, "Lab Tasks"), true);
  assert.equal(isLabWork({ title: "Lab 3: Joins" }, ""), true);
  assert.equal(isLabWork({ title: "Laboratory report" }, undefined), true);
  assert.equal(isLabWork({ title: "Syllabus overview" }, "Week 1"), false);
  assert.equal(isLabWork({ title: "Collaboration rules" }, ""), false);
});

test("classifies coursework by the student's own submission state and due date", () => {
  const items = buildStudentCoursework({
    now: NOW,
    courses: [course],
    courseworkByCourse: {
      c1: [
        work({ id: "upcoming" }),
        work({ id: "overdue", dueDate: { year: 2026, month: 11, day: 1 } }),
        work({ id: "done", dueDate: { year: 2026, month: 11, day: 20 } }),
        work({ id: "undated", dueDate: undefined, dueTime: undefined }),
      ],
    },
    submissionsByCourse: {
      c1: [
        { courseWorkId: "upcoming", state: "CREATED", alternateLink: "https://classroom.google.com/sub/upcoming" },
        { courseWorkId: "overdue", state: "NEW", late: true },
        { courseWorkId: "done", state: "TURNED_IN" },
      ],
    },
    topicsByCourse: {},
  });

  const statusById = Object.fromEntries(items.map((item) => [item.id, item.status]));
  assert.deepEqual(statusById, { overdue: "OVERDUE", upcoming: "DUE", undated: "NO_DUE_DATE", done: "TURNED_IN" });
  assert.deepEqual(items.map((item) => item.id), ["overdue", "upcoming", "undated", "done"]);
});

test("links to the student's own submission when available, falling back to the coursework link", () => {
  const [withSubmission, withoutSubmission] = buildStudentCoursework({
    now: NOW,
    courses: [course],
    courseworkByCourse: { c1: [work({ id: "a" }), work({ id: "b", dueDate: { year: 2026, month: 12, day: 1 } })] },
    submissionsByCourse: { c1: [{ courseWorkId: "a", state: "CREATED", alternateLink: "https://classroom.google.com/sub/a" }] },
    topicsByCourse: {},
  });

  assert.equal(withSubmission.link, "https://classroom.google.com/sub/a");
  assert.equal(withoutSubmission.link, "https://classroom.google.com/c/c1/a/w1");
});

test("only exposes Classroom links on the classroom.google.com domain", () => {
  const [item] = buildStudentCoursework({
    now: NOW,
    courses: [{ ...course, alternateLink: "javascript:alert(1)" }],
    courseworkByCourse: { c1: [work({ alternateLink: "https://evil.example/phish" })] },
    submissionsByCourse: {},
    topicsByCourse: {},
  });

  assert.equal(item.link, null);
  assert.equal(item.courseLink, null);
});

test("returns the course, topic, lab flag and points, and skips unpublished coursework", () => {
  const items = buildStudentCoursework({
    now: NOW,
    courses: [course],
    courseworkByCourse: { c1: [work({ topicId: "t1" }), work({ id: "draft", state: "DRAFT" })] },
    submissionsByCourse: {},
    topicsByCourse: { c1: [{ topicId: "t1", name: "Lab Work" }] },
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].courseName, "CSE 320 Database");
  assert.equal(items[0].topic, "Lab Work");
  assert.equal(items[0].isLab, true);
  assert.equal(items[0].maxPoints, 10);
  assert.equal(items[0].dueAt, "2026-11-14T17:59:00.000Z");
});

test("fetches every active course's coursework, submissions and topics across pages", async () => {
  const calls = [];
  const page = (data, nextPageToken) => ({ data: { ...data, nextPageToken } });
  const classroom = {
    courses: {
      list: async (params) => {
        calls.push(["courses", params]);
        return page({ courses: [course] });
      },
      courseWork: {
        list: async (params) => {
          calls.push(["courseWork", params]);
          return params.pageToken ? page({ courseWork: [work({ id: "w2" })] }) : page({ courseWork: [work()] }, "next");
        },
        studentSubmissions: {
          list: async (params) => {
            calls.push(["submissions", params]);
            return page({ studentSubmissions: [{ courseWorkId: "w1", state: "TURNED_IN" }] });
          },
        },
      },
      topics: {
        list: async () => page({ topic: [{ topicId: "t1", name: "Labs" }] }),
      },
    },
  };

  const items = await fetchStudentCoursework(classroom, { now: NOW });

  assert.deepEqual(items.map((item) => item.id).sort(), ["w1", "w2"]);
  assert.deepEqual(calls.find(([name]) => name === "courses")[1], { studentId: "me", courseStates: ["ACTIVE"], pageSize: 100 });
  assert.equal(calls.find(([name]) => name === "submissions")[1].courseWorkId, "-");
  assert.equal(calls.find(([name]) => name === "submissions")[1].userId, "me");
});
