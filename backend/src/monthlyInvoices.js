// Monthly ৳5,000 fee invoice for every active student, created on the 1st and due on the 10th (Dhaka time).

export const MONTHLY_FEE_AMOUNT = '5000.00';
const DUE_DAY = 10;
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000; // Bangladesh is UTC+6 all year (no daylight saving)
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dhakaMonth(now) {
  const dhaka = new Date(now.getTime() + DHAKA_OFFSET_MS);
  return { year: dhaka.getUTCFullYear(), month: dhaka.getUTCMonth() };
}

export function buildMonthlyInvoices(students, now = new Date()) {
  const { year, month } = dhakaMonth(now);
  const label = `${MONTH_NAMES[month]} ${year}`;
  const period = `${year}${String(month + 1).padStart(2, '0')}`;
  // 23:59 on the due day in Dhaka, stored in UTC.
  const dueDate = new Date(Date.UTC(year, month, DUE_DAY, 23, 59) - DHAKA_OFFSET_MS);
  return students.map((student) => ({
    // One number per student per month: the unique index is what stops double billing.
    invoiceNumber: `INV-M-${period}-${student.id}`,
    studentId: student.id,
    feeType: `Monthly Fee · ${label}`,
    description: `Monthly fee for ${label}`,
    amount: MONTHLY_FEE_AMOUNT,
    currency: 'BDT',
    dueDate,
    status: 'UNPAID',
  }));
}

// Safe to run repeatedly: existing invoices for the month are skipped.
export async function createMonthlyInvoices(db, now = new Date()) {
  const students = await db.user.findMany({ where: { role: 'STUDENT', isActive: true }, select: { id: true } });
  const data = buildMonthlyInvoices(students, now);
  const { count } = data.length ? await db.feeInvoice.createMany({ data, skipDuplicates: true }) : { count: 0 };
  const { year, month } = dhakaMonth(now);
  return { month: `${MONTH_NAMES[month]} ${year}`, students: students.length, created: count };
}
