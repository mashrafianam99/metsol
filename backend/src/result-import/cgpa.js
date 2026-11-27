// Builds semester-by-semester GPA and cumulative CGPA from imported official result records.
import { calculateResultSummary, SPECIAL_GRADES } from '../../../shared/grading.js';

const TERM_ORDER = [
  [/spring|winter/iu, 1],
  [/summer/iu, 2],
  [/fall|autumn/iu, 3],
];

// Sort key for a term label such as "Spring 2025", "Fall-24", "Semester 3" or "2nd".
function termKey(semester, academicYear) {
  const label = `${semester ?? ''} ${academicYear ?? ''}`;
  const year4 = label.match(/(19|20)\d{2}/u)?.[0];
  const year2 = !year4 && label.match(/[-\s'](\d{2})\b/u)?.[1];
  const year = year4 ? Number(year4) : year2 ? 2000 + Number(year2) : null;
  const named = TERM_ORDER.find(([pattern]) => pattern.test(label))?.[1] ?? null;
  const numbered = named === null ? Number(String(semester ?? '').match(/\d+/u)?.[0] ?? NaN) : NaN;
  return { year, term: named ?? (Number.isFinite(numbered) ? numbered : null) };
}

export function compareTerms(a, b) {
  const ka = termKey(a.semester, a.academicYear);
  const kb = termKey(b.semester, b.academicYear);
  if (ka.year !== null && kb.year !== null && ka.year !== kb.year) return ka.year - kb.year;
  if (ka.term !== null && kb.term !== null && ka.term !== kb.term) return ka.term - kb.term;
  return 0;
}

const uniqueValue = (records, field) => {
  const values = [...new Set(records.map((record) => record[field]).filter((value) => value !== null && value !== undefined))];
  return values.length === 1 ? values[0] : null;
};

const gpaOf = (records) => {
  const summary = calculateResultSummary(records);
  return summary.gpaCredits > 0 || records.some((record) => !SPECIAL_GRADES.has(record.grade)) ? summary.semesterGpa : null;
};

/**
 * Groups records by term in chronological order. Each term gets:
 * - gpa: the university's term GPA if the PDF gives one, otherwise calculated from that term's grades
 * - cgpa: the university's CGPA if given, otherwise calculated from every term up to and including this one
 * Returns { semesters, cgpa, cgpaSource } where cgpa is the latest cumulative CGPA.
 */
export function buildCgpaSummary(records) {
  const groups = new Map();
  for (const record of records) {
    const key = `${record.semester ?? ''}|${record.academicYear ?? ''}`;
    if (!groups.has(key)) groups.set(key, { semester: record.semester ?? null, academicYear: record.academicYear ?? null, records: [] });
    groups.get(key).records.push(record);
  }
  const ordered = [...groups.values()]
    .map((group, index) => ({ ...group, index }))
    .sort((a, b) => compareTerms(a, b) || a.index - b.index);

  const seen = [];
  const semesters = ordered.map((group) => {
    seen.push(...group.records);
    const reportedGpa = uniqueValue(group.records, 'gpa');
    const reportedCgpa = uniqueValue(group.records, 'cgpa');
    const summary = calculateResultSummary(group.records);
    return {
      semester: group.semester,
      academicYear: group.academicYear,
      gpa: reportedGpa ?? gpaOf(group.records),
      cgpa: reportedCgpa ?? gpaOf(seen),
      cgpaSource: reportedCgpa !== null ? 'university' : 'calculated',
      credits: summary.attemptedCredits,
      courseCount: group.records.length,
    };
  });

  const latest = semesters.at(-1);
  return {
    semesters,
    cgpa: latest?.cgpa ?? null,
    cgpaSource: latest && latest.cgpa !== null ? latest.cgpaSource : null,
  };
}
