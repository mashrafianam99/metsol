import assert from "node:assert/strict";
import test from "node:test";
import { buildMonthlyInvoices, createMonthlyInvoices, MONTHLY_FEE_AMOUNT } from "../src/monthlyInvoices.js";

// 1 Dec 2026, 00:05 in Dhaka (UTC+6) is still 30 Nov in UTC.
const FIRST_OF_DECEMBER_DHAKA = new Date("2026-11-30T18:05:00Z");

test("bills each student once for the Dhaka month, due on the 10th", () => {
  const [invoice] = buildMonthlyInvoices([{ id: "u1" }], FIRST_OF_DECEMBER_DHAKA);
  assert.equal(MONTHLY_FEE_AMOUNT, "5000.00");
  assert.deepEqual(invoice, {
    invoiceNumber: "INV-M-202612-u1",
    studentId: "u1",
    feeType: "Monthly Fee · December 2026",
    description: "Monthly fee for December 2026",
    amount: "5000.00",
    currency: "BDT",
    dueDate: new Date("2026-12-10T17:59:00Z"), // 10 Dec, 23:59 in Dhaka
    status: "UNPAID",
  });
});

test("uses a per-student, per-month invoice number so reruns never double-bill", () => {
  const numbers = buildMonthlyInvoices([{ id: "u1" }, { id: "u2" }], FIRST_OF_DECEMBER_DHAKA).map((i) => i.invoiceNumber);
  assert.deepEqual(numbers, ["INV-M-202612-u1", "INV-M-202612-u2"]);
  const january = buildMonthlyInvoices([{ id: "u1" }], new Date("2027-01-01T00:00:00Z"))[0];
  assert.equal(january.invoiceNumber, "INV-M-202701-u1");
  assert.equal(january.dueDate.toISOString(), "2027-01-10T17:59:00.000Z");
});

test("creates invoices for active students only and skips ones that already exist", async () => {
  const calls = {};
  const db = {
    user: { findMany: async (args) => { calls.findMany = args; return [{ id: "u1" }, { id: "u2" }]; } },
    feeInvoice: { createMany: async (args) => { calls.createMany = args; return { count: 1 }; } },
  };
  const result = await createMonthlyInvoices(db, FIRST_OF_DECEMBER_DHAKA);
  assert.deepEqual(calls.findMany.where, { role: "STUDENT", isActive: true });
  assert.equal(calls.createMany.skipDuplicates, true);
  assert.equal(calls.createMany.data.length, 2);
  assert.deepEqual(result, { month: "December 2026", students: 2, created: 1 });
});
