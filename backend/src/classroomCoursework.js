// Read-only view of a student's own Google Classroom coursework.
// Nothing here is stored: the portal shows live data and sends students to Classroom to submit.

const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const CLASSROOM_ORIGIN = 'https://classroom.google.com';
const DONE_STATES = new Set(['TURNED_IN', 'RETURNED']);
const STATUS_ORDER = ['OVERDUE', 'DUE', 'NO_DUE_DATE', 'TURNED_IN'];
const LAB_PATTERN = /\blab(oratory|s)?\b/iu;
const MAX_DESCRIPTION_LENGTH = 500;

// Classroom stores due dates and times in UTC; a missing hour or minute means 0.
export function getDueAt(courseWork) {
  const date = courseWork?.dueDate;
  if (!date?.year || !date?.month || !date?.day) return null;
  const time = courseWork.dueTime || {};
  return new Date(Date.UTC(date.year, date.month - 1, date.day, time.hours || 0, time.minutes || 0));
}

// Classroom has no "lab" type, so lab work is recognised by its topic or title.
export function isLabWork(courseWork, topicName) {
  return LAB_PATTERN.test(topicName || '') || LAB_PATTERN.test(courseWork?.title || '');
}

// Only pass through links that point at Classroom itself, never arbitrary URLs.
function safeClassroomLink(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.origin === CLASSROOM_ORIGIN ? parsed.href : null;
  } catch {
    return null;
  }
}

function getStatus(submission, dueAt, now) {
  if (DONE_STATES.has(submission?.state)) return 'TURNED_IN';
  if (!dueAt) return 'NO_DUE_DATE';
  return dueAt < now ? 'OVERDUE' : 'DUE';
}

function compareItems(a, b) {
  const byStatus = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
  if (byStatus !== 0) return byStatus;
  if (a.status === 'TURNED_IN') return (b.dueAt || '').localeCompare(a.dueAt || '');
  if (a.status === 'NO_DUE_DATE') return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  return (a.dueAt || '').localeCompare(b.dueAt || '');
}

function toItem({ courseWork, course, submission, topicName, now }) {
  const dueAt = getDueAt(courseWork);
  return {
    id: courseWork.id,
    courseId: course.id,
    courseName: course.name || 'Google Classroom course',
    courseSection: course.section || null,
    courseLink: safeClassroomLink(course.alternateLink),
    title: courseWork.title || 'Untitled coursework',
    description: String(courseWork.description || '').slice(0, MAX_DESCRIPTION_LENGTH),
    workType: courseWork.workType || 'ASSIGNMENT',
    topic: topicName || null,
    isLab: isLabWork(courseWork, topicName),
    dueAt: dueAt ? dueAt.toISOString() : null,
    maxPoints: courseWork.maxPoints || null,
    status: getStatus(submission, dueAt, now),
    submissionState: submission?.state || null,
    late: Boolean(submission?.late),
    assignedGrade: submission?.assignedGrade ?? null,
    updatedAt: courseWork.updateTime || null,
    // The submission link opens the student's own work page, where Classroom's "Turn in" button lives.
    link: safeClassroomLink(submission?.alternateLink) || safeClassroomLink(courseWork.alternateLink),
  };
}

export function buildStudentCoursework({ courses, courseworkByCourse, submissionsByCourse, topicsByCourse, now = new Date() }) {
  const items = [];
  for (const course of courses) {
    const submissions = new Map((submissionsByCourse[course.id] || []).map((submission) => [submission.courseWorkId, submission]));
    const topics = new Map((topicsByCourse[course.id] || []).map((topic) => [topic.topicId, topic.name]));
    for (const courseWork of courseworkByCourse[course.id] || []) {
      if (courseWork.state && courseWork.state !== 'PUBLISHED') continue;
      items.push(toItem({ courseWork, course, submission: submissions.get(courseWork.id), topicName: topics.get(courseWork.topicId), now }));
    }
  }
  return items.sort(compareItems);
}

async function listAllPages(request, params, field) {
  const results = [];
  let pageToken;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data } = await request({ ...params, ...(pageToken ? { pageToken } : {}) });
    results.push(...(data?.[field] || []));
    pageToken = data?.nextPageToken;
    if (!pageToken) break;
  }
  return results;
}

// Topics are only used for lab detection, so a failure there must not hide the coursework.
async function listTopicsSafely(classroom, courseId) {
  try {
    return await listAllPages((params) => classroom.courses.topics.list(params), { courseId, pageSize: PAGE_SIZE }, 'topic');
  } catch (error) {
    console.warn(`Google Classroom topics unavailable for course ${courseId}:`, error?.message || error);
    return [];
  }
}

export async function fetchStudentCoursework(classroom, { now = new Date() } = {}) {
  const courses = await listAllPages(
    (params) => classroom.courses.list(params),
    { studentId: 'me', courseStates: ['ACTIVE'], pageSize: PAGE_SIZE },
    'courses',
  );

  const perCourse = await Promise.all(courses.map(async (course) => {
    const [courseWork, submissions, topics] = await Promise.all([
      listAllPages((params) => classroom.courses.courseWork.list(params), { courseId: course.id, pageSize: PAGE_SIZE }, 'courseWork'),
      listAllPages(
        (params) => classroom.courses.courseWork.studentSubmissions.list(params),
        { courseId: course.id, courseWorkId: '-', userId: 'me', pageSize: PAGE_SIZE },
        'studentSubmissions',
      ),
      listTopicsSafely(classroom, course.id),
    ]);
    return { courseId: course.id, courseWork, submissions, topics };
  }));

  const byCourse = (field) => Object.fromEntries(perCourse.map((entry) => [entry.courseId, entry[field]]));
  return buildStudentCoursework({
    now,
    courses,
    courseworkByCourse: byCourse('courseWork'),
    submissionsByCourse: byCourse('submissions'),
    topicsByCourse: byCourse('topics'),
  });
}
