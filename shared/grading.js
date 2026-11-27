export const MU_GRADE_SCALE = [
  { grade: "A+", min: 80, points: 4.0 },
  { grade: "A", min: 75, points: 3.75 },
  { grade: "A-", min: 70, points: 3.5 },
  { grade: "B+", min: 65, points: 3.25 },
  { grade: "B", min: 60, points: 3.0 },
  { grade: "B-", min: 55, points: 2.75 },
  { grade: "C+", min: 50, points: 2.5 },
  { grade: "C", min: 45, points: 2.25 },
  { grade: "D", min: 40, points: 2.0 },
  { grade: "F", min: 0, points: 0.0 },
];

export const LETTER_GRADE_MAP = {
  "A+": 4.0,
  A: 3.75,
  "A-": 3.5,
  "B+": 3.25,
  B: 3.0,
  "B-": 2.75,
  "C+": 2.5,
  C: 2.25,
  D: 2.0,
  F: 0.0,
  I: 0.0,
  W: 0.0,
  S: 0.0,
  AB: 0.0,
};

export const SPECIAL_GRADES = new Set(["I", "W", "S", "AB"]);

export const getGradePointForGrade = (grade) => LETTER_GRADE_MAP[grade] ?? 0;

export const isEarnedCredit = (grade) => Boolean(grade) && !SPECIAL_GRADES.has(grade) && grade !== "F";

export const getGradeFromScore = (score) => {
  if (score === "" || score === null || score === undefined) return null;
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > 100) return null;

  const { grade, points } = MU_GRADE_SCALE.find(({ min }) => numericScore >= min);
  return { grade, gradePoint: points };
};

export const calculateResultSummary = (records) => {
  const validRecords = records.filter((record) => {
    const credits = Number(record.credits ?? record.credit);
    return Boolean(record.grade) && Number.isFinite(credits) && credits > 0;
  });
  const attemptedCredits = validRecords.reduce(
    (total, record) => total + Number(record.credits ?? record.credit),
    0
  );
  const earnedCredits = validRecords.reduce((total, record) => (
    isEarnedCredit(record.grade) ? total + Number(record.credits ?? record.credit) : total
  ), 0);
  const gpaRecords = validRecords.filter((record) => !SPECIAL_GRADES.has(record.grade));
  const gpaCredits = gpaRecords.reduce(
    (total, record) => total + Number(record.credits ?? record.credit),
    0
  );
  const totalQualityPoints = gpaRecords.reduce((total, record) => {
    const gradePoint = SPECIAL_GRADES.has(record.grade)
      ? 0
      : Number.isFinite(record.gradePoint) ? record.gradePoint : getGradePointForGrade(record.grade);
    return total + gradePoint * Number(record.credits ?? record.credit);
  }, 0);

  return {
    totalQualityPoints,
    attemptedCredits,
    earnedCredits,
    courseCount: validRecords.length,
    gpaCredits,
    semesterGpa: gpaCredits > 0 ? totalQualityPoints / gpaCredits : 0,
  };
};

// CGPA = all quality points earned so far / all credits that count towards GPA so far.
// previousCgpa and previousCredits describe the record before the new courses (both optional).
export const calculateCgpa = ({ previousCgpa = 0, previousCredits = 0, qualityPoints = 0, gpaCredits = 0 }) => {
  const priorCredits = Number(previousCredits) > 0 ? Number(previousCredits) : 0;
  const priorPoints = priorCredits * (Number(previousCgpa) || 0);
  const totalCredits = priorCredits + Number(gpaCredits || 0);
  return totalCredits > 0 ? (priorPoints + Number(qualityPoints || 0)) / totalCredits : 0;
};
