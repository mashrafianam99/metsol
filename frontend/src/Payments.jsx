import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, readJson } from "./api.js";
import "./payments.css";

const CONFIRM_MESSAGES = {
  SUCCESS: "Payment received. Your invoice is now marked as paid.",
  PENDING: "Stripe is still processing your payment. Refresh in a moment to see the update.",
  FAILED: "The payment did not go through. You were not charged.",
};

const formatTaka = (value) => `৳${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const formatDate = (value) => (value ? new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");

async function postJson(path, body) {
  const response = await apiFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await readJson(response);
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

// After Stripe Checkout, the browser comes back with ?payment=success&session_id=... or ?payment=cancelled.
async function readCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const outcome = params.get("payment");
  if (!outcome) return "";
  window.history.replaceState({}, "", window.location.pathname);
  if (outcome === "cancelled") return "Payment cancelled. You were not charged.";
  const sessionId = params.get("session_id");
  if (outcome !== "success" || !sessionId) return "";
  try {
    const { status } = await postJson("/api/payments/stripe/confirm", { sessionId });
    return CONFIRM_MESSAGES[status] || "We couldn't confirm this payment yet. Refresh in a moment.";
  } catch (error) {
    return error.message;
  }
}

function StatusBadge({ status }) {
  const tone = status === "PAID" || status === "SUCCESS" ? "success" : "warning";
  const label = { PAID: "Paid", UNPAID: "Unpaid", SUCCESS: "Paid", PENDING: "Pending", FAILED: "Failed" }[status] || status;
  return <span className={`badge ${tone}`}>{label}</span>;
}

function CreateInvoiceForm({ onCreated }) {
  const [students, setStudents] = useState([]);
  const [form, setForm] = useState({ studentId: "", feeType: "", amount: "", dueDate: "", description: "" });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch("/api/admin/users")
      .then(readJson)
      .then((users) => setStudents(Array.isArray(users) ? users.filter((user) => user.role === "STUDENT") : []))
      .catch(() => setMessage("Couldn't load the student list."));
  }, []);

  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const invoice = await postJson("/api/invoices", { ...form, amount: Number(form.amount) });
      setMessage(`Invoice ${invoice.invoiceNumber} created.`);
      setForm({ studentId: "", feeType: "", amount: "", dueDate: "", description: "" });
      onCreated();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card payment-form-card payment-form" onSubmit={submit}>
      <div className="card-header payment-form-wide"><div><h3>Create invoice</h3><span>Bill a student for a fee. They pay it with Stripe.</span></div></div>
      <label>Student
        <select required value={form.studentId} onChange={update("studentId")}>
          <option value="">Choose a student</option>
          {students.map((student) => <option key={student.id} value={student.id}>{student.name}{student.studentId ? ` · ${student.studentId}` : ""}</option>)}
        </select>
      </label>
      <label>Fee type<input required maxLength={80} value={form.feeType} onChange={update("feeType")} placeholder="e.g. Tuition Fee" /></label>
      <label>Amount (৳)<input required type="number" min="1" step="0.01" value={form.amount} onChange={update("amount")} placeholder="12500" /></label>
      <label>Due date<input type="date" value={form.dueDate} onChange={update("dueDate")} /></label>
      <label className="payment-form-wide">Description (optional)<input maxLength={500} value={form.description} onChange={update("description")} /></label>
      <div className="payment-form-wide"><button className="primary-button" disabled={saving}>{saving ? "Creating..." : "Create invoice"}</button></div>
      {message && <p className="payment-message payment-form-wide" role="status">{message}</p>}
    </form>
  );
}

export default function Payments({ user }) {
  const isAdmin = user?.role === "ADMIN";
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [payingId, setPayingId] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await apiFetch("/api/invoices");
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Unable to load invoices.");
      setInvoices(data);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    readCheckoutReturn().then((text) => { if (text) setMessage(text); }).finally(load);
  }, [load]);

  const pay = async (invoice) => {
    setPayingId(invoice.id);
    setMessage("");
    try {
      const { url } = await postJson("/api/payments/checkout", { invoiceId: invoice.id });
      window.location.assign(url); // Stripe's hosted Checkout page
    } catch (error) {
      setMessage(error.message);
      setPayingId("");
    }
  };

  const totals = useMemo(() => {
    const billed = invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
    const paid = invoices.filter((invoice) => invoice.status === "PAID").reduce((sum, invoice) => sum + Number(invoice.amount), 0);
    return { billed, paid, due: billed - paid, percent: billed ? Math.round((paid / billed) * 100) : 0 };
  }, [invoices]);

  const history = useMemo(() => invoices
    .flatMap((invoice) => invoice.payments.map((payment) => ({ ...payment, invoice })))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [invoices]);

  return (
    <>
      <div className="stats-grid">
        <div className="card payment-stat"><span>Total billed</span><strong>{formatTaka(totals.billed)}</strong></div>
        <div className="card payment-stat"><span>Paid</span><strong className="success">{formatTaka(totals.paid)}</strong><small>{totals.percent}% of total</small></div>
        <div className="card payment-stat"><span>Remaining</span><strong className={totals.due ? "warning" : ""}>{formatTaka(totals.due)}</strong></div>
      </div>

      {message && <div className="payment-message" role="status">{message}</div>}

      {isAdmin && <CreateInvoiceForm onCreated={load} />}

      <div className="card">
        <div className="card-header"><div><h3>{isAdmin ? "All invoices" : "Your invoices"}</h3><span>Paid securely with Stripe (test mode)</span></div></div>
        {loading ? <p className="payment-muted">Loading invoices...</p> : !invoices.length ? (
          <p className="payment-muted">{isAdmin ? "No invoices yet. Create one above." : "You have no invoices right now."}</p>
        ) : (
          <div className="table payment-table">
            {invoices.map((invoice) => (
              <div className="table-row" key={invoice.id}>
                <div>
                  <strong>{invoice.feeType}</strong>
                  <small>{invoice.invoiceNumber}{isAdmin && invoice.student ? ` · ${invoice.student.name}` : ""}</small>
                </div>
                <span>{formatTaka(invoice.amount)}</span>
                <span>Due {formatDate(invoice.dueDate)}</span>
                <StatusBadge status={invoice.status} />
                {!isAdmin && invoice.status !== "PAID" ? (
                  <button className="primary-button" onClick={() => pay(invoice)} disabled={Boolean(payingId)}>
                    {payingId === invoice.id ? "Opening Stripe..." : "Pay with Stripe"}
                  </button>
                ) : <span />}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header"><div><h3>Payment history</h3><span>Every Stripe payment attempt</span></div></div>
        {!history.length ? <p className="payment-muted">No payments yet.</p> : (
          <div className="table payment-table">
            {history.map((payment) => (
              <div className="table-row" key={payment.id}>
                <div><strong>{payment.invoice.feeType}</strong><small>{payment.invoice.invoiceNumber}</small></div>
                <span>{formatTaka(payment.amount)}</span>
                <span>{formatDate(payment.verifiedAt || payment.createdAt)}</span>
                <StatusBadge status={payment.status} />
                <span className="payment-muted">{payment.provider === "STRIPE" ? "Stripe" : payment.provider}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
