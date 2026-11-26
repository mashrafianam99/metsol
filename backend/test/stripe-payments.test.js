import assert from "node:assert/strict";
import test from "node:test";
import { applyCheckoutSession, buildCheckoutParams, getStripe, StripeConfigError, toStripeAmount } from "../src/stripePayments.js";

const invoice = { id: "inv1", invoiceNumber: "INV-2026-ABC123", feeType: "Tuition Fee", amount: "12500.00", currency: "BDT", status: "UNPAID" };
const attempt = { id: "att1", reference: "ref-1", invoiceId: "inv1", provider: "STRIPE", amount: "12500.00", currency: "BDT", status: "PENDING", providerPaymentId: "cs_test_1", invoice };

function paidSession(overrides = {}) {
  return { id: "cs_test_1", client_reference_id: "ref-1", payment_status: "paid", status: "complete", amount_total: 1250000, currency: "bdt", payment_intent: "pi_test_1", ...overrides };
}

// Minimal stand-in for the Prisma client: records writes so tests can check them.
function fakeDb(found) {
  const writes = [];
  return {
    writes,
    paymentAttempt: {
      findUnique: async ({ where }) => (found && found.reference === where.reference ? found : null),
      update: (args) => { writes.push(["attempt", args.data]); return args; },
    },
    feeInvoice: { update: (args) => { writes.push(["invoice", args.data]); return args; } },
    $transaction: async (ops) => ops,
  };
}

test("converts invoice amounts to Stripe's smallest currency unit and rejects bad amounts", () => {
  assert.equal(toStripeAmount("12500.00"), 1250000);
  assert.equal(toStripeAmount(99.99), 9999);
  for (const bad of [0, -5, "abc", null, Infinity]) assert.throws(() => toStripeAmount(bad));
});

test("only accepts Stripe test keys, so live money can't be charged by mistake", () => {
  assert.throws(() => getStripe(""), StripeConfigError);
  assert.throws(() => getStripe("sk_live_123"), StripeConfigError);
  assert.ok(getStripe("sk_test_123").checkout);
});

test("builds a Checkout session priced from the invoice, returning to the portal", () => {
  const params = buildCheckoutParams({ invoice, attempt, frontendBaseUrl: "https://portal.test", customerEmail: "s@uni.test" });
  assert.equal(params.mode, "payment");
  assert.equal(params.client_reference_id, "ref-1");
  assert.equal(params.customer_email, "s@uni.test");
  assert.deepEqual(params.line_items[0].price_data, { currency: "bdt", unit_amount: 1250000, product_data: { name: "Tuition Fee · INV-2026-ABC123" } });
  assert.equal(params.success_url, "https://portal.test/?payment=success&session_id={CHECKOUT_SESSION_ID}");
  assert.equal(params.cancel_url, "https://portal.test/?payment=cancelled");
  assert.deepEqual(params.metadata, { invoiceId: "inv1", reference: "ref-1" });
});

test("marks the attempt and invoice paid when Stripe reports a paid session", async () => {
  const db = fakeDb(attempt);
  const result = await applyCheckoutSession(db, paidSession());
  assert.equal(result.status, "SUCCESS");
  assert.deepEqual(db.writes.map(([table, data]) => [table, data.status]), [["attempt", "SUCCESS"], ["invoice", "PAID"]]);
  assert.equal(db.writes[0][1].providerTrxId, "pi_test_1");
});

test("does nothing twice: an already-successful attempt is left alone", async () => {
  const db = fakeDb({ ...attempt, status: "SUCCESS" });
  assert.equal((await applyCheckoutSession(db, paidSession())).status, "SUCCESS");
  assert.equal(db.writes.length, 0);
});

test("refuses sessions that don't match the stored attempt or the invoice amount", async () => {
  assert.equal((await applyCheckoutSession(fakeDb(attempt), paidSession({ id: "cs_test_other" }))).status, "UNKNOWN");
  assert.equal((await applyCheckoutSession(fakeDb(null), paidSession())).status, "UNKNOWN");
  const db = fakeDb(attempt);
  assert.equal((await applyCheckoutSession(db, paidSession({ amount_total: 100 }))).status, "MISMATCH");
  assert.equal(db.writes.length, 0);
});

test("marks the attempt failed when the Checkout session expires unpaid", async () => {
  const db = fakeDb(attempt);
  const result = await applyCheckoutSession(db, paidSession({ payment_status: "unpaid", status: "expired" }));
  assert.equal(result.status, "FAILED");
  assert.deepEqual(db.writes.map(([table, data]) => [table, data.status]), [["attempt", "FAILED"]]);
});

test("leaves an open, unpaid session pending", async () => {
  const db = fakeDb(attempt);
  assert.equal((await applyCheckoutSession(db, paidSession({ payment_status: "unpaid", status: "open" }))).status, "PENDING");
  assert.equal(db.writes.length, 0);
});
