// Fee payments through Stripe Checkout (test mode only).
// Stripe hosts the card form, so card details never reach this server.
import Stripe from 'stripe';

// sk_ = secret key, rk_ = restricted key, rkcs_ = restricted key of a CLI-created sandbox.
const TEST_KEY_PATTERN = /^(sk|rk|rkcs)_test_/u;
// Tags these sessions in the Stripe Dashboard; the random suffix is required by Stripe.
const INTEGRATION_IDENTIFIER = 'portal_fees_qmvkzrta';

export class StripeConfigError extends Error {}

export function getStripe(secretKey = process.env.STRIPE_SECRET_KEY) {
  if (!secretKey) throw new StripeConfigError('Stripe is not configured. Set STRIPE_SECRET_KEY in backend/.env.');
  // shortcut: test mode only, as agreed for this project; allow sk_live_/rk_live_ here before taking real payments.
  if (!TEST_KEY_PATTERN.test(secretKey)) throw new StripeConfigError('Only Stripe test keys (sk_test_, rk_test_ or rkcs_test_) are allowed.');
  return new Stripe(secretKey);
}

// Stripe wants integers in the currency's smallest unit (BDT has 2 decimals: 12500.00 -> 1250000).
export function toStripeAmount(amount) {
  // String() also covers Prisma Decimal objects; null, booleans and '' become NaN or 0 and are rejected below.
  const value = Number(String(amount));
  const minor = Math.round(value * 100);
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error(`Invalid payment amount: ${amount}`);
  return minor;
}

export function buildCheckoutParams({ invoice, attempt, frontendBaseUrl, customerEmail }) {
  const base = frontendBaseUrl.replace(/\/+$/u, '');
  return {
    mode: 'payment',
    integration_identifier: INTEGRATION_IDENTIFIER,
    client_reference_id: attempt.reference,
    ...(customerEmail ? { customer_email: customerEmail } : {}),
    line_items: [{
      quantity: 1,
      price_data: {
        currency: invoice.currency.toLowerCase(),
        unit_amount: toStripeAmount(invoice.amount),
        product_data: { name: `${invoice.feeType} · ${invoice.invoiceNumber}` },
      },
    }],
    metadata: { invoiceId: invoice.id, reference: attempt.reference },
    success_url: `${base}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/?payment=cancelled`,
  };
}

// Records what Stripe says about a Checkout session. Safe to call repeatedly (webhook retries, page reloads).
// Only trusts sessions fetched from Stripe or delivered by a signature-checked webhook.
export async function applyCheckoutSession(db, session, { failed = false } = {}) {
  const reference = session?.client_reference_id || session?.metadata?.reference;
  if (!reference) return { status: 'UNKNOWN' };
  const attempt = await db.paymentAttempt.findUnique({ where: { reference }, include: { invoice: true } });
  if (!attempt || attempt.providerPaymentId !== session.id) return { status: 'UNKNOWN' };
  if (attempt.status === 'SUCCESS') return { status: 'SUCCESS', attempt };

  if (session.payment_status !== 'unpaid' && !failed) {
    const expected = toStripeAmount(attempt.amount);
    if (session.amount_total !== expected || session.currency !== attempt.currency.toLowerCase()) {
      console.error(`Stripe amount mismatch for payment ${attempt.reference}: got ${session.amount_total} ${session.currency}, expected ${expected}`);
      return { status: 'MISMATCH', attempt };
    }
    const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    await db.$transaction([
      db.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'SUCCESS', verifiedAt: new Date(), providerTrxId: paymentIntentId || null } }),
      db.feeInvoice.update({ where: { id: attempt.invoiceId }, data: { status: 'PAID' } }),
    ]);
    return { status: 'SUCCESS', attempt };
  }

  if (failed || session.status === 'expired') {
    if (attempt.status !== 'FAILED') await db.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED' } });
    return { status: 'FAILED', attempt };
  }
  return { status: 'PENDING', attempt };
}
