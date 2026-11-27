import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, readJson } from "./api.js";
import { Icon } from "./icons.jsx";
import "./admin.css";

const Transport = React.lazy(() => import("./Transport.jsx"));

const SECTIONS = [
  { id: "overview", label: "Overview", icon: "grid", group: "Console" },
  { id: "users", label: "Users & roles", icon: "users", group: "People" },
  { id: "notices", label: "Notices", icon: "megaphone", group: "Communication" },
  { id: "payments", label: "Fees & invoices", icon: "wallet", group: "Finance" },
  { id: "results", label: "Official results", icon: "chart", group: "Academics" },
  { id: "courses", label: "Courses", icon: "book", group: "Academics" },
  { id: "attendance", label: "Attendance", icon: "calendarCheck", group: "Academics", teachers: true },
  { id: "transport", label: "Transport", icon: "bus", group: "Campus" },
];
const sectionsFor = (role) => SECTIONS.filter((section) => role === "ADMIN" || (role === "TEACHER" && section.teachers));
const ROLE_LABELS = { STUDENT: "Student", TEACHER: "Teacher", ADMIN: "Administrator", TRANSPORT_ADMIN: "Transport admin" };
const CATEGORY_LABELS = { GENERAL: "General", ACADEMIC: "Academic", EXAM: "Exam", EVENT: "Event", URGENT: "Urgent", TRANSPORT: "Transport" };
const AUDIENCE_LABELS = { ALL: "Everyone", STUDENT: "Students", TEACHER: "Teachers" };

// ---------- helpers ----------
const taka = (value) => `৳${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const shortDate = (value) => (value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
const dateTime = (value) => (value ? new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const initialsOf = (name = "") => name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
const isOverdue = (invoice) => invoice.status === "UNPAID" && invoice.dueDate && new Date(invoice.dueDate) < new Date();

async function request(path, { method = "GET", body, form } = {}) {
  const options = { method };
  if (form) options.body = form;
  else if (body !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }
  const response = await apiFetch(path, options);
  if (response.status === 204) return null;
  const data = await readJson(response);
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function useResource(path) {
  const [state, setState] = useState({ data: null, error: "", loading: true });
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      setState({ data: await request(path), error: "", loading: false });
    } catch (error) {
      setState((current) => ({ ...current, error: error.message, loading: false }));
    }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: (data) => setState((current) => ({ ...current, data: typeof data === "function" ? data(current.data) : data })) };
}

// ---------- shared UI ----------
function Badge({ tone = "neutral", children }) {
  return <span className={`ad-badge ad-badge-${tone}`}>{children}</span>;
}

function InvoiceStatus({ invoice }) {
  if (invoice.status === "PAID") return <Badge tone="success">Paid</Badge>;
  if (invoice.status === "CANCELLED") return <Badge tone="neutral">Cancelled</Badge>;
  return isOverdue(invoice) ? <Badge tone="danger">Overdue</Badge> : <Badge tone="warning">Unpaid</Badge>;
}

function Card({ title, subtitle, actions, children, className = "" }) {
  return (
    <section className={`ad-card ${className}`.trim()}>
      {(title || actions) && (
        <header className="ad-card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="ad-card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

function Kpi({ icon, tone, label, value, hint, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} className={`ad-kpi ad-tone-${tone}`} onClick={onClick}>
      <span className="ad-kpi-icon"><Icon name={icon} size={20} /></span>
      <span className="ad-kpi-label">{label}</span>
      <strong className="ad-kpi-value">{value}</strong>
      {hint && <span className="ad-kpi-hint">{hint}</span>}
    </Tag>
  );
}

function Empty({ icon = "folder", title, children }) {
  return (
    <div className="ad-empty">
      <span><Icon name={icon} size={22} /></span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

function Skeleton({ rows = 4 }) {
  return <div className="ad-skeleton" aria-busy="true">{Array.from({ length: rows }, (_, i) => <span key={i} />)}</div>;
}

function ErrorNote({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="ad-alert ad-alert-error" role="alert">
      <Icon name="alert" size={16} />
      <span>{message}</span>
      {onRetry && <button type="button" className="ad-link" onClick={onRetry}>Try again</button>}
    </div>
  );
}

function Modal({ title, subtitle, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="ad-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`ad-modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="ad-icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </header>
        <div className="ad-modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

function Field({ label, hint, children, wide }) {
  return (
    <label className={`ad-field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

// Confirm dialogs and toasts are provided once at the top of the console.
const ConsoleContext = React.createContext({ toast: () => {}, confirm: async () => false });
const useConsole = () => React.useContext(ConsoleContext);

function ConsoleProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const toast = useCallback((message, tone = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list, { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), 4200);
  }, []);
  const confirm = useCallback((options) => new Promise((resolve) => setDialog({ ...options, resolve })), []);
  const close = (answer) => {
    dialog?.resolve(answer);
    setDialog(null);
  };
  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);
  return (
    <ConsoleContext.Provider value={value}>
      {children}
      <div className="ad-toasts" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`ad-toast ad-toast-${item.tone}`}>
            <Icon name={item.tone === "error" ? "alert" : "check"} size={16} />
            <span>{item.message}</span>
          </div>
        ))}
      </div>
      {dialog && (
        <Modal
          title={dialog.title}
          onClose={() => close(false)}
          footer={(
            <>
              <button type="button" className="ad-btn ghost" onClick={() => close(false)}>Cancel</button>
              <button type="button" className={`ad-btn ${dialog.danger ? "danger" : "primary"}`} onClick={() => close(true)}>{dialog.confirmLabel || "Confirm"}</button>
            </>
          )}
        >
          <p className="ad-confirm-text">{dialog.message}</p>
        </Modal>
      )}
    </ConsoleContext.Provider>
  );
}

// ---------- shell ----------
export default function AdminPanel({ user, dark, onToggleTheme, onSignOut, onOpenPortal }) {
  const sections = sectionsFor(user.role);
  const groups = [...new Set(sections.map((item) => item.group))];
  const isTeacher = user.role === "TEACHER";
  const [section, setSection] = useState(sections[0].id);
  const [navOpen, setNavOpen] = useState(false);
  const current = sections.find((item) => item.id === section);
  const go = (id) => {
    setSection(id);
    setNavOpen(false);
    window.scrollTo({ top: 0 });
  };

  return (
    <ConsoleProvider>
      <div className={`ad-shell ${navOpen ? "nav-open" : ""}`}>
        <div className="ad-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />
        <aside className="ad-side" aria-label="Admin navigation">
          <div className="ad-brand">
            <div className="ad-brand-mark">MU</div>
            <div>
              <strong>{isTeacher ? "Teacher Console" : "Admin Console"}</strong>
              <span>Metropolitan University</span>
            </div>
          </div>
          <nav className="ad-nav">
            {groups.map((group) => (
              <div key={group} className="ad-nav-group">
                <span className="ad-nav-label">{group}</span>
                {sections.filter((item) => item.group === group).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`ad-nav-item ${section === item.id ? "active" : ""}`}
                    aria-current={section === item.id ? "page" : undefined}
                    onClick={() => go(item.id)}
                  >
                    <Icon name={item.icon} size={18} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="ad-side-foot">
            <button type="button" className="ad-nav-item" onClick={onOpenPortal}>
              <Icon name="external" size={18} />
              <span>Open student portal</span>
            </button>
            <button type="button" className="ad-nav-item" onClick={onSignOut}>
              <Icon name="logout" size={18} />
              <span>Sign out</span>
            </button>
          </div>
        </aside>

        <div className="ad-main">
          <header className="ad-top">
            <button type="button" className="ad-icon-btn ad-menu" onClick={() => setNavOpen(true)} aria-label="Open navigation"><Icon name="menu" size={20} /></button>
            <div className="ad-top-title">
              <span>{current.group}</span>
              <h1>{current.label}</h1>
            </div>
            <div className="ad-top-actions">
              <button type="button" className="ad-icon-btn" onClick={onToggleTheme} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Light mode" : "Dark mode"}>
                <Icon name={dark ? "sun" : "moon"} size={18} />
              </button>
              <div className="ad-user">
                <span className="ad-avatar">{initialsOf(user.name)}</span>
                <div>
                  <strong>{user.name}</strong>
                  <span><Icon name="shield" size={12} /> {isTeacher ? `Teacher${user.department ? ` · ${user.department}` : ""}` : "Administrator"}</span>
                </div>
              </div>
            </div>
          </header>

          <main className="ad-content" key={section}>
            {section === "overview" && <Overview go={go} />}
            {section === "users" && <Users me={user} />}
            {section === "notices" && <Notices />}
            {section === "payments" && <Payments />}
            {section === "results" && <Results />}
            {section === "courses" && <Courses />}
            {section === "attendance" && <Attendance user={user} />}
            {section === "transport" && (
              <div className="ad-embed">
                <React.Suspense fallback={<Skeleton rows={6} />}>
                  <Transport user={user} />
                </React.Suspense>
              </div>
            )}
          </main>
        </div>
      </div>
    </ConsoleProvider>
  );
}

// ---------- Overview ----------
function Overview({ go }) {
  const { data, error, loading, reload } = useResource("/api/admin/overview");
  if (loading && !data) return <div className="ad-grid-kpi">{Array.from({ length: 6 }, (_, i) => <div key={i} className="ad-kpi ad-kpi-loading" />)}</div>;
  if (!data) return <ErrorNote message={error} onRetry={reload} />;
  const { users, invoices, transport, results, recent, services } = data;
  const outstanding = invoices.UNPAID;
  const totalBilled = invoices.PAID.amount + invoices.UNPAID.amount;
  const collectionRate = totalBilled ? Math.round((invoices.PAID.amount / totalBilled) * 100) : 0;
  const quick = [
    { label: "Publish a notice", icon: "megaphone", to: "notices" },
    { label: "Create invoice", icon: "wallet", to: "payments" },
    { label: "Import results PDF", icon: "upload", to: "results" },
    { label: "Manage transport", icon: "bus", to: "transport" },
    { label: "Add an account", icon: "user", to: "users" },
  ];
  const serviceRows = [
    ["Account provisioning", services.userProvisioning, "Supabase service key"],
    ["Stripe payments", services.stripe, "STRIPE_SECRET_KEY"],
    ["AI assistant", services.ai, "GROQ_API_KEY"],
    ["Google Classroom", services.googleClassroom, "Google OAuth client"],
    ["Road routing", services.roadRouting, "OSRM_ROUTING_URL"],
  ];

  return (
    <div className="ad-stack">
      <div className="ad-hero">
        <div>
          <h2>Welcome back</h2>
          <p>Here's what's happening across the portal today.</p>
        </div>
        <button type="button" className="ad-btn ghost" onClick={reload} disabled={loading}><Icon name="refresh" size={16} /> Refresh</button>
      </div>

      <div className="ad-grid-kpi">
        <Kpi icon="users" tone="brand" label="Students" value={users.STUDENT.toLocaleString()} hint={`${users.newStudents30d} joined in the last 30 days`} onClick={() => go("users")} />
        <Kpi icon="wallet" tone="warning" label="Outstanding fees" value={taka(outstanding.amount)} hint={`${outstanding.count} unpaid invoice${outstanding.count === 1 ? "" : "s"}`} onClick={() => go("payments")} />
        <Kpi icon="check" tone="success" label="Collected · 30 days" value={taka(invoices.collected30d)} hint={`${collectionRate}% of all billed fees paid`} onClick={() => go("payments")} />
        <Kpi icon="alert" tone="danger" label="Overdue" value={invoices.overdue.count.toLocaleString()} hint={invoices.overdue.count ? `${taka(invoices.overdue.amount)} past due` : "Nothing past due"} onClick={() => go("payments")} />
        <Kpi icon="megaphone" tone="info" label="Notices" value={data.notices.toLocaleString()} hint="Published to students & staff" onClick={() => go("notices")} />
        <Kpi icon="bus" tone="violet" label="Active buses" value={transport.activeBuses.toLocaleString()} hint={`${transport.routes} routes · ${transport.stops} stops`} onClick={() => go("transport")} />
      </div>

      <div className="ad-grid-2">
        <Card title="Recent invoices" subtitle="Latest fee invoices across all students" actions={<button type="button" className="ad-link" onClick={() => go("payments")}>View all <Icon name="arrowRight" size={14} /></button>}>
          {recent.invoices.length ? (
            <div className="ad-table-wrap">
              <table className="ad-table">
                <thead><tr><th>Student</th><th>Fee</th><th className="num">Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {recent.invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td><div className="ad-person"><span className="ad-avatar sm">{initialsOf(invoice.student?.name)}</span><div><strong>{invoice.student?.name}</strong><small>{invoice.student?.studentId || invoice.student?.email}</small></div></div></td>
                      <td>{invoice.feeType}</td>
                      <td className="num">{taka(invoice.amount)}</td>
                      <td><InvoiceStatus invoice={invoice} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty icon="wallet" title="No invoices yet">Create one from Fees & invoices.</Empty>}
        </Card>

        <Card title="Quick actions">
          <div className="ad-quick">
            {quick.map((item) => (
              <button key={item.label} type="button" onClick={() => go(item.to)}>
                <span><Icon name={item.icon} size={18} /></span>
                {item.label}
                <Icon name="arrowRight" size={14} />
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div className="ad-grid-3">
        <Card title="Latest notices" actions={<button type="button" className="ad-link" onClick={() => go("notices")}>Manage</button>}>
          {recent.notices.length ? (
            <ul className="ad-list">
              {recent.notices.map((notice) => (
                <li key={notice.id}>
                  <div><strong>{notice.title}</strong><small>{AUDIENCE_LABELS[notice.audience] || notice.audience} · {shortDate(notice.createdAt)}</small></div>
                  <Badge tone={notice.category === "URGENT" ? "danger" : "info"}>{CATEGORY_LABELS[notice.category] || notice.category}</Badge>
                </li>
              ))}
            </ul>
          ) : <Empty icon="megaphone" title="No notices yet" />}
        </Card>

        <Card title="Academics & campus">
          <ul className="ad-list">
            <li><div><strong>Official results</strong><small>{results.latest ? `${results.latest.fileName} · ${shortDate(results.latest.uploadedAt)}` : "No result PDF imported yet"}</small></div><Badge tone={results.imports ? "success" : "neutral"}>{results.imports} import{results.imports === 1 ? "" : "s"}</Badge></li>
            <li><div><strong>Bus schedule</strong><small>{transport.schedule ? `${transport.schedule.fileName} · ${shortDate(transport.schedule.publishedAt)}` : "No schedule published"}</small></div><Badge tone={transport.schedule ? "success" : "warning"}>{transport.schedule ? "Published" : "Missing"}</Badge></li>
            <li><div><strong>Staff accounts</strong><small>{users.TEACHER} teachers · {users.ADMIN} admins · {users.TRANSPORT_ADMIN} transport admins</small></div><Badge tone={users.inactive ? "warning" : "neutral"}>{users.inactive} inactive</Badge></li>
          </ul>
        </Card>

        <Card title="Integrations" subtitle="Configured in backend/.env">
          <ul className="ad-list">
            {serviceRows.map(([label, on, hint]) => (
              <li key={label}>
                <div><strong>{label}</strong><small>{hint}</small></div>
                <span className={`ad-status ${on ? "on" : "off"}`}><i />{on ? "Connected" : "Not set"}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// ---------- Users ----------
const EMPTY_USER = { name: "", email: "", password: "", role: "STUDENT", studentId: "", department: "", batch: "", section: "", phone: "" };

function Users({ me }) {
  const { toast, confirm } = useConsole();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const { data, error, loading, reload, setData } = useResource("/api/admin/accounts");
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState(null);

  const accounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data || []).filter((account) =>
      (!role || account.role === role)
      && (!status || (status === "active" ? account.isActive : !account.isActive))
      && (!q || [account.name, account.email, account.studentId, account.department].some((value) => value?.toLowerCase().includes(q))));
  }, [data, query, role, status]);
  const counts = useMemo(() => (data || []).reduce((acc, account) => ({ ...acc, [account.role]: (acc[account.role] || 0) + 1 }), {}), [data]);

  async function update(account, patch, message) {
    try {
      const updated = await request(`/api/admin/accounts/${account.id}`, { method: "PATCH", body: patch });
      setData((list) => list.map((item) => (item.id === updated.id ? updated : item)));
      toast(message);
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function changeRole(account, nextRole) {
    if (nextRole === account.role) return;
    const ok = await confirm({ title: "Change role?", message: `${account.name} will become ${ROLE_LABELS[nextRole]}. Their access changes the next time they load the portal.`, confirmLabel: "Change role" });
    if (ok) update(account, { role: nextRole }, `${account.name} is now ${ROLE_LABELS[nextRole]}.`);
  }

  async function toggleActive(account) {
    if (account.isActive) {
      const ok = await confirm({ title: "Deactivate account?", message: `${account.name} won't be able to use the portal until you reactivate them.`, confirmLabel: "Deactivate", danger: true });
      if (!ok) return;
    }
    update(account, { isActive: !account.isActive }, `${account.name} ${account.isActive ? "deactivated" : "reactivated"}.`);
  }

  return (
    <div className="ad-stack">
      <div className="ad-chips">
        {[["", "All", data?.length || 0], ...Object.keys(ROLE_LABELS).map((key) => [key, ROLE_LABELS[key], counts[key] || 0])].map(([key, label, count]) => (
          <button key={label} type="button" className={`ad-chip ${role === key ? "active" : ""}`} onClick={() => setRole(key)}>{label}<b>{count}</b></button>
        ))}
      </div>

      <Card
        title="Accounts"
        subtitle="Everyone who can sign in to the portal"
        actions={<button type="button" className="ad-btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Add account</button>}
      >
        <div className="ad-toolbar">
          <label className="ad-search"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, student ID or department" /></label>
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button type="button" className="ad-icon-btn" onClick={reload} aria-label="Refresh" title="Refresh"><Icon name="refresh" size={16} /></button>
        </div>
        <ErrorNote message={error} onRetry={reload} />
        {loading && !data ? <Skeleton /> : accounts.length ? (
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead><tr><th>Name</th><th>Role</th><th>Academic</th><th>Status</th><th>Joined</th><th className="actions">Actions</th></tr></thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} className={account.isActive ? "" : "muted"}>
                    <td>
                      <div className="ad-person">
                        <span className="ad-avatar sm">{initialsOf(account.name)}</span>
                        <div><strong>{account.name}{account.id === me.id && <em> (you)</em>}</strong><small>{account.email}</small></div>
                      </div>
                    </td>
                    <td>
                      <select className="ad-inline-select" value={account.role} onChange={(event) => changeRole(account, event.target.value)} disabled={account.id === me.id} aria-label={`Role for ${account.name}`}>
                        {Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                      </select>
                    </td>
                    <td><span className="ad-meta">{[account.studentId, account.department, account.batch && `Batch ${account.batch}`, account.section && `Sec ${account.section}`].filter(Boolean).join(" · ") || "—"}</span></td>
                    <td>
                      {account.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
                      {!account.hasSignIn && <Badge tone="warning">Not signed in</Badge>}
                    </td>
                    <td className="nowrap">{shortDate(account.createdAt)}</td>
                    <td className="actions">
                      <button type="button" className="ad-icon-btn" title="Set a new password" aria-label={`Set a new password for ${account.name}`} onClick={() => setResetFor(account)} disabled={!account.hasSignIn}><Icon name="key" size={16} /></button>
                      <button type="button" className={`ad-btn sm ${account.isActive ? "ghost" : "soft"}`} onClick={() => toggleActive(account)} disabled={account.id === me.id}>{account.isActive ? "Deactivate" : "Activate"}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon="users" title="No matching accounts">Try a different search or filter.</Empty>}
      </Card>

      {creating && <CreateUserModal onClose={() => setCreating(false)} onCreated={(account) => { setData((list) => [account, ...(list || [])]); setCreating(false); toast(`${account.name} can now sign in.`); }} />}
      {resetFor && <ResetPasswordModal account={resetFor} onClose={() => setResetFor(null)} onDone={() => { toast(`Password updated for ${resetFor.name}.`); setResetFor(null); }} />}
    </div>
  );
}

function CreateUserModal({ onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_USER);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const isStudent = form.role === "STUDENT";

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      onCreated(await request("/api/admin/accounts", { method: "POST", body: form }));
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Add an account"
      subtitle="The person can sign in straight away. No verification email is sent."
      onClose={onClose}
      wide
      footer={(
        <>
          <button type="button" className="ad-btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="ad-create-user" className="ad-btn primary" disabled={saving}>{saving ? "Creating…" : "Create account"}</button>
        </>
      )}
    >
      <form id="ad-create-user" className="ad-form" onSubmit={submit}>
        <Field label="Full name"><input value={form.name} onChange={set("name")} required maxLength={100} autoFocus /></Field>
        <Field label="Role">
          <select value={form.role} onChange={set("role")}>
            {Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </Field>
        <Field label="Email"><input type="email" value={form.email} onChange={set("email")} required /></Field>
        <Field label="Initial password" hint="At least 8 characters. Share it with the person securely."><input type="text" value={form.password} onChange={set("password")} required minLength={8} autoComplete="new-password" /></Field>
        <Field label={isStudent ? "Student ID" : "Staff ID (optional)"}><input value={form.studentId} onChange={set("studentId")} required={isStudent} maxLength={50} /></Field>
        <Field label="Department"><input value={form.department} onChange={set("department")} maxLength={100} /></Field>
        {isStudent && <Field label="Batch"><input value={form.batch} onChange={set("batch")} maxLength={50} /></Field>}
        {isStudent && <Field label="Section"><input value={form.section} onChange={set("section")} maxLength={50} /></Field>}
        <Field label="Phone (optional)"><input value={form.phone} onChange={set("phone")} maxLength={30} /></Field>
        {error && <div className="ad-alert ad-alert-error wide" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ account, onClose, onDone }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await request(`/api/admin/accounts/${account.id}/password`, { method: "POST", body: { password } });
      onDone();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }
  return (
    <Modal
      title="Set a new password"
      subtitle={`${account.name} · ${account.email}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="ad-btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="ad-reset-pass" className="ad-btn primary" disabled={saving}>{saving ? "Saving…" : "Update password"}</button>
        </>
      )}
    >
      <form id="ad-reset-pass" className="ad-form single" onSubmit={submit}>
        <Field label="New password" hint="At least 8 characters."><input type="text" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required autoFocus autoComplete="new-password" /></Field>
        {error && <div className="ad-alert ad-alert-error" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}
      </form>
    </Modal>
  );
}

// ---------- Notices ----------
const EMPTY_NOTICE = { title: "", body: "", category: "GENERAL", audience: "ALL", notify: true };

function Notices() {
  const { toast, confirm } = useConsole();
  const { data, error, loading, reload, setData } = useResource("/api/admin/notices");
  const [form, setForm] = useState(EMPTY_NOTICE);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [filter, setFilter] = useState("");
  const composerRef = useRef(null);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value }));

  const notices = (data || []).filter((notice) => !filter || notice.category === filter);

  function edit(notice) {
    setEditingId(notice.id);
    setForm({ title: notice.title, body: notice.body, category: notice.category, audience: notice.audience, notify: false });
    setFormError("");
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function reset() {
    setEditingId(null);
    setForm(EMPTY_NOTICE);
    setFormError("");
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      if (editingId) {
        const updated = await request(`/api/admin/notices/${editingId}`, { method: "PATCH", body: form });
        setData((list) => list.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
        toast("Notice updated.");
      } else {
        const created = await request("/api/admin/notices", { method: "POST", body: form });
        toast(created.notified ? `Notice published. ${created.notified} people notified.` : "Notice published.");
        reload();
      }
      reset();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(notice) {
    const ok = await confirm({ title: "Delete notice?", message: `"${notice.title}" will be removed for everyone, along with its notifications.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await request(`/api/admin/notices/${notice.id}`, { method: "DELETE" });
      setData((list) => list.filter((item) => item.id !== notice.id));
      if (editingId === notice.id) reset();
      toast("Notice deleted.");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  return (
    <div className="ad-split">
      <div ref={composerRef}>
        <Card title={editingId ? "Edit notice" : "New notice"} subtitle={editingId ? "Changes appear immediately for everyone." : "Published on the portal's Notices page and dashboard."} className="ad-sticky">
          <form className="ad-form single" onSubmit={submit}>
            <Field label="Title"><input value={form.title} onChange={set("title")} required maxLength={160} placeholder="e.g. Mid-term exam schedule published" /></Field>
            <div className="ad-form two">
              <Field label="Category">
                <select value={form.category} onChange={set("category")}>
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </Field>
              <Field label="Audience">
                <select value={form.audience} onChange={set("audience")}>
                  {Object.entries(AUDIENCE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Message" hint={`${form.body.length.toLocaleString()} / 10,000`}><textarea value={form.body} onChange={set("body")} required maxLength={10000} rows={7} placeholder="Write the full notice…" /></Field>
            {!editingId && (
              <label className="ad-check">
                <input type="checkbox" checked={form.notify} onChange={set("notify")} />
                <span>Send an in-portal notification to the audience</span>
              </label>
            )}
            {formError && <div className="ad-alert ad-alert-error" role="alert"><Icon name="alert" size={16} /><span>{formError}</span></div>}
            <div className="ad-form-actions">
              {editingId && <button type="button" className="ad-btn ghost" onClick={reset}>Cancel edit</button>}
              <button type="submit" className="ad-btn primary" disabled={saving}><Icon name={editingId ? "check" : "megaphone"} size={16} /> {saving ? "Saving…" : editingId ? "Save changes" : "Publish notice"}</button>
            </div>
          </form>
        </Card>
      </div>

      <Card
        title="Published notices"
        subtitle={`${data?.length || 0} total`}
        actions={(
          <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter by category">
            <option value="">All categories</option>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        )}
      >
        <ErrorNote message={error} onRetry={reload} />
        {loading && !data ? <Skeleton rows={5} /> : notices.length ? (
          <div className="ad-notices">
            {notices.map((notice) => (
              <article key={notice.id} className={`ad-notice ${editingId === notice.id ? "editing" : ""}`}>
                <header>
                  <div className="ad-notice-tags">
                    <Badge tone={notice.category === "URGENT" ? "danger" : notice.category === "TRANSPORT" ? "violet" : "info"}>{CATEGORY_LABELS[notice.category] || notice.category}</Badge>
                    <Badge tone="neutral">{AUDIENCE_LABELS[notice.audience] || notice.audience}</Badge>
                  </div>
                  <div className="ad-notice-actions">
                    <button type="button" className="ad-icon-btn" onClick={() => edit(notice)} aria-label={`Edit ${notice.title}`} title="Edit"><Icon name="edit" size={16} /></button>
                    <button type="button" className="ad-icon-btn danger" onClick={() => remove(notice)} aria-label={`Delete ${notice.title}`} title="Delete"><Icon name="trash" size={16} /></button>
                  </div>
                </header>
                <h3>{notice.title}</h3>
                <p>{notice.body}</p>
                <footer>
                  <span>{notice.author?.name || "System"} · {dateTime(notice.createdAt)}</span>
                  <span><Icon name="bell" size={13} /> {notice._count?.notifications ?? 0} notified</span>
                </footer>
              </article>
            ))}
          </div>
        ) : <Empty icon="megaphone" title="No notices">Write the first one on the left.</Empty>}
      </Card>
    </div>
  );
}

// ---------- Payments ----------
function Payments() {
  const [tab, setTab] = useState("invoices");
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((value) => value + 1);
  return (
    <div className="ad-stack">
      <div className="ad-tabs" role="tablist">
        {[["invoices", "All invoices", "fileText"], ["single", "New invoice", "plus"], ["bulk", "Bulk billing", "layers"]].map(([id, label, icon]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon name={icon} size={16} /> {label}</button>
        ))}
      </div>
      {tab === "invoices" && <InvoiceTable key={version} />}
      {tab === "single" && <SingleInvoice onCreated={() => { refresh(); setTab("invoices"); }} />}
      {tab === "bulk" && <BulkBilling onCreated={() => { refresh(); setTab("invoices"); }} />}
    </div>
  );
}

function InvoiceTable() {
  const { toast, confirm } = useConsole();
  const { data, error, loading, reload, setData } = useResource("/api/admin/invoices");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const all = data || [];
  const invoices = all.filter((invoice) => {
    const q = query.trim().toLowerCase();
    const matchesStatus = !status || (status === "OVERDUE" ? isOverdue(invoice) : invoice.status === status);
    return matchesStatus && (!q || [invoice.invoiceNumber, invoice.feeType, invoice.student?.name, invoice.student?.email, invoice.student?.studentId].some((value) => value?.toLowerCase().includes(q)));
  });
  const sum = (list) => list.reduce((total, invoice) => total + Number(invoice.amount), 0);
  const unpaid = all.filter((invoice) => invoice.status === "UNPAID");
  const paid = all.filter((invoice) => invoice.status === "PAID");
  const overdue = all.filter(isOverdue);

  async function setInvoiceStatus(invoice, next) {
    const copy = {
      PAID: ["Mark as paid?", `Record a manual (cash or bank) payment of ${taka(invoice.amount)} from ${invoice.student?.name}.`, "Mark paid"],
      CANCELLED: ["Cancel invoice?", `${invoice.invoiceNumber} will no longer be payable.`, "Cancel invoice"],
      UNPAID: ["Reopen invoice?", `${invoice.invoiceNumber} will become payable again.`, "Reopen"],
    }[next];
    const ok = await confirm({ title: copy[0], message: copy[1], confirmLabel: copy[2], danger: next === "CANCELLED" });
    if (!ok) return;
    try {
      const updated = await request(`/api/admin/invoices/${invoice.id}`, { method: "PATCH", body: { status: next } });
      setData((list) => list.map((item) => (item.id === updated.id ? updated : item)));
      toast(`${invoice.invoiceNumber} updated.`);
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function remove(invoice) {
    const ok = await confirm({ title: "Delete invoice?", message: `${invoice.invoiceNumber} (${taka(invoice.amount)}) will be permanently deleted.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await request(`/api/admin/invoices/${invoice.id}`, { method: "DELETE" });
      setData((list) => list.filter((item) => item.id !== invoice.id));
      toast("Invoice deleted.");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  return (
    <>
      <div className="ad-grid-kpi four">
        <Kpi icon="fileText" tone="brand" label="All invoices" value={all.length.toLocaleString()} hint={taka(sum(all.filter((invoice) => invoice.status !== "CANCELLED"))) + " billed"} />
        <Kpi icon="clock" tone="warning" label="Unpaid" value={taka(sum(unpaid))} hint={`${unpaid.length} invoices`} />
        <Kpi icon="check" tone="success" label="Paid" value={taka(sum(paid))} hint={`${paid.length} invoices`} />
        <Kpi icon="alert" tone="danger" label="Overdue" value={taka(sum(overdue))} hint={`${overdue.length} invoices`} />
      </div>
      <Card title="Invoices" subtitle="Students pay unpaid invoices online with Stripe. Record cash or bank payments here.">
        <div className="ad-toolbar">
          <label className="ad-search"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search invoice number, fee or student" /></label>
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
            <option value="">Any status</option>
            <option value="UNPAID">Unpaid</option>
            <option value="OVERDUE">Overdue</option>
            <option value="PAID">Paid</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <button type="button" className="ad-icon-btn" onClick={reload} aria-label="Refresh" title="Refresh"><Icon name="refresh" size={16} /></button>
        </div>
        <ErrorNote message={error} onRetry={reload} />
        {loading && !data ? <Skeleton /> : invoices.length ? (
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead><tr><th>Invoice</th><th>Student</th><th className="num">Amount</th><th>Due</th><th>Status</th><th className="actions">Actions</th></tr></thead>
              <tbody>
                {invoices.map((invoice) => {
                  const paidVia = invoice.payments?.find((payment) => payment.status === "SUCCESS")?.provider;
                  return (
                    <tr key={invoice.id}>
                      <td><strong>{invoice.feeType}</strong><small className="ad-mono">{invoice.invoiceNumber}</small></td>
                      <td><div className="ad-person"><span className="ad-avatar sm">{initialsOf(invoice.student?.name)}</span><div><strong>{invoice.student?.name}</strong><small>{invoice.student?.studentId || invoice.student?.email}</small></div></div></td>
                      <td className="num"><strong>{taka(invoice.amount)}</strong></td>
                      <td className="nowrap">{shortDate(invoice.dueDate)}</td>
                      <td><InvoiceStatus invoice={invoice} />{paidVia && <small className="ad-via">via {paidVia === "MANUAL" ? "manual entry" : "Stripe"}</small>}</td>
                      <td className="actions">
                        {invoice.status === "UNPAID" && <button type="button" className="ad-btn sm soft" onClick={() => setInvoiceStatus(invoice, "PAID")}>Mark paid</button>}
                        {invoice.status === "UNPAID" && <button type="button" className="ad-btn sm ghost" onClick={() => setInvoiceStatus(invoice, "CANCELLED")}>Cancel</button>}
                        {invoice.status !== "UNPAID" && paidVia !== "STRIPE" && <button type="button" className="ad-btn sm ghost" onClick={() => setInvoiceStatus(invoice, "UNPAID")}>Reopen</button>}
                        {invoice.status !== "PAID" && <button type="button" className="ad-icon-btn danger" onClick={() => remove(invoice)} aria-label={`Delete ${invoice.invoiceNumber}`} title="Delete"><Icon name="trash" size={16} /></button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty icon="wallet" title="No invoices match">Change the filters, or create an invoice.</Empty>}
      </Card>
    </>
  );
}

function useStudents() {
  const { data } = useResource("/api/admin/accounts");
  return useMemo(() => (data || []).filter((account) => account.role === "STUDENT" && account.isActive), [data]);
}

const FEE_PRESETS = ["Tuition Fee", "Semester Fee", "Exam Fee", "Lab Fee", "Library Fine", "Transport Fee", "Admission Fee"];

function InvoiceFields({ form, set }) {
  return (
    <>
      <Field label="Fee type">
        <input value={form.feeType} onChange={set("feeType")} list="ad-fee-presets" required maxLength={80} placeholder="e.g. Semester Fee" />
        <datalist id="ad-fee-presets">{FEE_PRESETS.map((fee) => <option key={fee} value={fee} />)}</datalist>
      </Field>
      <Field label="Amount (৳)"><input type="number" min="1" step="0.01" value={form.amount} onChange={set("amount")} required placeholder="5000" /></Field>
      <Field label="Due date"><input type="date" value={form.dueDate} onChange={set("dueDate")} /></Field>
      <Field label="Description (optional)" wide><input value={form.description} onChange={set("description")} maxLength={500} placeholder="Shown to the student on the invoice" /></Field>
    </>
  );
}

function SingleInvoice({ onCreated }) {
  const { toast } = useConsole();
  const students = useStudents();
  const [form, setForm] = useState({ studentId: "", feeType: "", amount: "", dueDate: "", description: "" });
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const filtered = students.filter((student) => !search || [student.name, student.studentId, student.email].some((value) => value?.toLowerCase().includes(search.toLowerCase())));
  const selected = students.find((student) => student.id === form.studentId);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const invoice = await request("/api/admin/invoices", { method: "POST", body: { ...form, amount: Number(form.amount) } });
      toast(`${invoice.invoiceNumber} created for ${invoice.student?.name}.`);
      onCreated();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Card title="Create an invoice" subtitle="Bill one student. They see it on their Payments page and can pay with Stripe.">
      <form className="ad-form" onSubmit={submit}>
        <Field label="Student" wide>
          <div className="ad-picker">
            <label className="ad-search"><Icon name="search" size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${students.length} active students`} /></label>
            <select value={form.studentId} onChange={set("studentId")} required size={Math.min(6, Math.max(3, filtered.length))}>
              {filtered.map((student) => <option key={student.id} value={student.id}>{student.name} · {student.studentId || student.email}{student.batch ? ` · Batch ${student.batch}` : ""}</option>)}
            </select>
            {selected && <small className="ad-selected"><Icon name="check" size={13} /> {selected.name} selected</small>}
          </div>
        </Field>
        <InvoiceFields form={form} set={set} />
        {error && <div className="ad-alert ad-alert-error wide" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}
        <div className="ad-form-actions wide"><button type="submit" className="ad-btn primary" disabled={saving || !form.studentId}><Icon name="plus" size={16} /> {saving ? "Creating…" : "Create invoice"}</button></div>
      </form>
    </Card>
  );
}

function BulkBilling({ onCreated }) {
  const { toast, confirm } = useConsole();
  const students = useStudents();
  const [form, setForm] = useState({ target: "ALL", batch: "", department: "", feeType: "", amount: "", dueDate: "", description: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const batches = [...new Set(students.map((student) => student.batch).filter(Boolean))].sort();
  const departments = [...new Set(students.map((student) => student.department).filter(Boolean))].sort();
  const matching = students.filter((student) =>
    form.target === "ALL"
    || (form.target === "BATCH" && student.batch?.toLowerCase() === form.batch.toLowerCase())
    || (form.target === "DEPARTMENT" && student.department?.toLowerCase() === form.department.toLowerCase())).length;

  async function submit(event) {
    event.preventDefault();
    const ok = await confirm({ title: "Bill these students?", message: `${matching} student${matching === 1 ? "" : "s"} will each receive a ${taka(form.amount)} "${form.feeType}" invoice.`, confirmLabel: `Create ${matching} invoices` });
    if (!ok) return;
    setSaving(true);
    setError("");
    try {
      const result = await request("/api/admin/invoices/bulk", { method: "POST", body: { ...form, amount: Number(form.amount) } });
      toast(`${result.created} invoices created.`);
      onCreated();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function runMonthly() {
    const ok = await confirm({ title: "Run this month's billing?", message: "Every active student gets this month's ৳5,000 fee invoice, due on the 10th. Students already billed this month are skipped.", confirmLabel: "Run billing" });
    if (!ok) return;
    setRunning(true);
    try {
      const result = await request("/api/admin/invoices/monthly-run", { method: "POST" });
      toast(result.created ? `${result.month}: ${result.created} invoices created.` : `${result.month}: everyone was already billed.`);
      if (result.created) onCreated();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="ad-grid-2 wide-left">
      <Card title="Bulk billing" subtitle="Send the same invoice to a whole group of active students.">
        <form className="ad-form" onSubmit={submit}>
          <Field label="Bill">
            <select value={form.target} onChange={set("target")}>
              <option value="ALL">All active students</option>
              <option value="BATCH">One batch</option>
              <option value="DEPARTMENT">One department</option>
            </select>
          </Field>
          {form.target === "BATCH" && (
            <Field label="Batch">
              <select value={form.batch} onChange={set("batch")} required>
                <option value="">Choose a batch</option>
                {batches.map((batch) => <option key={batch} value={batch}>Batch {batch}</option>)}
              </select>
            </Field>
          )}
          {form.target === "DEPARTMENT" && (
            <Field label="Department">
              <select value={form.department} onChange={set("department")} required>
                <option value="">Choose a department</option>
                {departments.map((department) => <option key={department} value={department}>{department}</option>)}
              </select>
            </Field>
          )}
          {form.target === "ALL" && <div />}
          <InvoiceFields form={form} set={set} />
          <div className="ad-summary wide">
            <Icon name="users" size={16} />
            <span><b>{matching}</b> student{matching === 1 ? "" : "s"} will be billed{form.amount ? <> · <b>{taka(Number(form.amount) * matching)}</b> in total</> : ""}</span>
          </div>
          {error && <div className="ad-alert ad-alert-error wide" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}
          <div className="ad-form-actions wide"><button type="submit" className="ad-btn primary" disabled={saving || !matching}><Icon name="layers" size={16} /> {saving ? "Creating…" : "Create invoices"}</button></div>
        </form>
      </Card>
      <Card title="Monthly fee run" subtitle="Runs automatically at 00:05 on the 1st (Dhaka time) when deployed.">
        <div className="ad-monthly">
          <strong>{taka(5000)}</strong>
          <span>per active student · due on the 10th</span>
          <p>Run it by hand to bill this month now, for example after adding new students. It's safe to run more than once: nobody gets billed twice for the same month.</p>
          <button type="button" className="ad-btn soft" onClick={runMonthly} disabled={running}><Icon name="refresh" size={16} /> {running ? "Running…" : "Run this month's billing"}</button>
        </div>
      </Card>
    </div>
  );
}

// ---------- Official results ----------
function Results() {
  const { toast, confirm } = useConsole();
  const { data, error, loading, reload, setData } = useResource("/api/admin/results/imports");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const formFor = (pdf) => {
    const form = new FormData();
    form.append("file", pdf);
    return form;
  };

  async function choose(pdf) {
    if (!pdf) return;
    setFile(pdf);
    setPreview(null);
    setUploadError("");
    if (pdf.type && pdf.type !== "application/pdf") return setUploadError("Choose a PDF file.");
    setBusy("preview");
    try {
      setPreview(await request("/api/admin/results/import/preview", { method: "POST", form: formFor(pdf) }));
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function importFile() {
    setBusy("import");
    setUploadError("");
    try {
      const result = await request("/api/admin/results/import", { method: "POST", form: formFor(file) });
      toast(`Imported ${result.recordCount} results for ${result.studentCount} students.`);
      setFile(null);
      setPreview(null);
      if (inputRef.current) inputRef.current.value = "";
      reload();
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function remove(item) {
    const ok = await confirm({ title: "Delete this import?", message: `All ${item.recordCount} results from ${item.fileName} will be removed. Students will see the previous import instead, if there is one.`, confirmLabel: "Delete import", danger: true });
    if (!ok) return;
    try {
      await request(`/api/admin/results/imports/${item.id}`, { method: "DELETE" });
      setData((list) => list.filter((entry) => entry.id !== item.id));
      toast("Import deleted.");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  return (
    <div className="ad-stack">
      <Card title="Import an official result PDF" subtitle="Students see results matched to the student ID on their own account. The PDF itself isn't stored.">
        <div
          className={`ad-drop ${dragging ? "dragging" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files?.[0]); }}
        >
          <span className="ad-drop-icon"><Icon name="upload" size={24} /></span>
          <strong>{file ? file.name : "Drop the university result PDF here"}</strong>
          <small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "Text-based PDF, up to 15 MB, with a single header row"}</small>
          <button type="button" className="ad-btn ghost" onClick={() => inputRef.current?.click()} disabled={Boolean(busy)}>{file ? "Choose another file" : "Browse files"}</button>
          <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => choose(event.target.files?.[0])} />
        </div>

        {busy === "preview" && <div className="ad-alert ad-alert-info"><Icon name="clock" size={16} /><span>Reading the PDF…</span></div>}
        {uploadError && <div className="ad-alert ad-alert-error" role="alert"><Icon name="alert" size={16} /><span>{uploadError}</span></div>}
        {preview && (
          <div className={`ad-preview ${preview.duplicate ? "duplicate" : ""}`}>
            <div className="ad-preview-stats">
              <div><span>Students</span><strong>{preview.studentCount}</strong></div>
              <div><span>Course results</span><strong>{preview.recordCount}</strong></div>
              <div><span>File</span><strong className="ad-ellipsis">{preview.fileName}</strong></div>
            </div>
            <p>{preview.duplicate ? `This exact PDF was already imported on ${shortDate(preview.alreadyImportedAt)}.` : preview.message}</p>
            <div className="ad-form-actions">
              <button type="button" className="ad-btn ghost" onClick={() => { setFile(null); setPreview(null); }}>Discard</button>
              <button type="button" className="ad-btn primary" onClick={importFile} disabled={preview.duplicate || busy === "import"}><Icon name="check" size={16} /> {busy === "import" ? "Importing…" : "Import results"}</button>
            </div>
          </div>
        )}
      </Card>

      <Card title="Import history" subtitle="Students see the most recent import." actions={<button type="button" className="ad-icon-btn" onClick={reload} aria-label="Refresh" title="Refresh"><Icon name="refresh" size={16} /></button>}>
        <ErrorNote message={error} onRetry={reload} />
        {loading && !data ? <Skeleton rows={3} /> : data?.length ? (
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead><tr><th>File</th><th className="num">Students</th><th className="num">Results</th><th>Uploaded</th><th>By</th><th className="actions" /></tr></thead>
              <tbody>
                {data.map((item, index) => (
                  <tr key={item.id}>
                    <td><div className="ad-file"><Icon name="fileText" size={18} /><div><strong>{item.fileName}</strong>{index === 0 && <Badge tone="success">Live</Badge>}</div></div></td>
                    <td className="num">{item.studentCount}</td>
                    <td className="num">{item.recordCount}</td>
                    <td className="nowrap">{dateTime(item.uploadedAt)}</td>
                    <td>{item.uploadedBy?.name || "—"}</td>
                    <td className="actions"><button type="button" className="ad-icon-btn danger" onClick={() => remove(item)} aria-label={`Delete ${item.fileName}`} title="Delete import"><Icon name="trash" size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon="chart" title="No results imported yet">Upload the first official result PDF above.</Empty>}
      </Card>
    </div>
  );
}

// ---------- Attendance ----------
// Teachers set each student's official attendance % for a course. They only see their own
// department's courses and students (enforced by the API); admins see all departments.
const parsePercent = (value) => (/^\d{1,3}$/.test(String(value).trim()) && Number(value) <= 100 ? Number(value) : null);

function Attendance({ user }) {
  const { toast } = useConsole();
  const courses = useResource("/api/attendance/courses");
  const [courseId, setCourseId] = useState("");
  const [filters, setFilters] = useState({ q: "", batch: "", section: "" });
  const [roster, setRoster] = useState({ students: [], loading: false, error: "" });
  const [drafts, setDrafts] = useState({}); // studentId -> text typed in the % box
  const [fillAll, setFillAll] = useState("");
  const [saving, setSaving] = useState(false);
  const activeCourse = courseId || courses.data?.[0]?.id || "";

  const loadRoster = useCallback(async () => {
    if (!activeCourse) return;
    setRoster((current) => ({ ...current, loading: true, error: "" }));
    try {
      const data = await request(`/api/attendance/roster?${new URLSearchParams({ courseId: activeCourse, ...filters })}`);
      setRoster({ students: data.students, loading: false, error: "" });
      setDrafts(Object.fromEntries(data.students.map((student) => [student.id, student.percent ?? ""])));
    } catch (error) {
      setRoster({ students: [], loading: false, error: error.message });
    }
  }, [activeCourse, filters]);

  useEffect(() => {
    const timer = setTimeout(loadRoster, 300); // debounce typing in the search fields
    return () => clearTimeout(timer);
  }, [loadRoster]);

  const edited = roster.students.filter((student) => String(drafts[student.id] ?? "") !== String(student.percent ?? ""));
  const invalid = edited.filter((student) => parsePercent(drafts[student.id]) === null);
  const setFilter = (key) => (event) => setFilters((current) => ({ ...current, [key]: event.target.value }));
  const applyToAll = () => parsePercent(fillAll) !== null && setDrafts(Object.fromEntries(roster.students.map((student) => [student.id, String(parsePercent(fillAll))])));

  async function save() {
    setSaving(true);
    try {
      const records = edited.map((student) => ({ studentId: student.id, percent: parsePercent(drafts[student.id]) }));
      await request("/api/attendance", { method: "PUT", body: { courseId: activeCourse, records } });
      const saved = new Map(records.map((record) => [record.studentId, record.percent]));
      setRoster((current) => ({ ...current, students: current.students.map((student) => (saved.has(student.id) ? { ...student, percent: saved.get(student.id), updatedAt: new Date().toISOString() } : student)) }));
      toast(`Attendance saved for ${records.length} student${records.length === 1 ? "" : "s"}.`);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  if (courses.error) return <ErrorNote message={courses.error} onRetry={courses.reload} />;
  if (courses.loading && !courses.data) return <Skeleton rows={6} />;
  if (!courses.data?.length) {
    return <Empty icon="calendarCheck" title="No courses to set attendance for">{user.role === "TEACHER" ? `There are no courses for the ${user.department} department yet.` : "Add courses first."}</Empty>;
  }

  return (
    <div className="ad-stack">
      <Card
        title="Course attendance"
        subtitle={`${user.role === "TEACHER" ? `Students in ${user.department}` : "All departments"} · enter each student's attendance % for the course`}
        actions={<button type="button" className="ad-btn primary" onClick={save} disabled={saving || !edited.length || invalid.length > 0}>{saving ? "Saving…" : `Save${edited.length ? ` (${edited.length})` : ""}`}</button>}
      >
        <div className="ad-toolbar">
          <select value={activeCourse} onChange={(event) => setCourseId(event.target.value)} aria-label="Course">
            {courses.data.map((course) => <option key={course.id} value={course.id}>{course.code} · {course.title}</option>)}
          </select>
          <label className="ad-search"><Icon name="search" size={16} /><input value={filters.q} onChange={setFilter("q")} placeholder="Search name or student ID" /></label>
          <input className="ad-input" value={filters.batch} onChange={setFilter("batch")} placeholder="Batch" aria-label="Batch" size={8} />
          <input className="ad-input" value={filters.section} onChange={setFilter("section")} placeholder="Section" aria-label="Section" size={8} />
        </div>
        <div className="ad-toolbar">
          <input className="ad-input" type="number" min={0} max={100} value={fillAll} onChange={(event) => setFillAll(event.target.value)} placeholder="%" aria-label="Percentage for everyone listed" style={{ width: 80 }} />
          <button type="button" className="ad-btn sm soft" onClick={applyToAll} disabled={!roster.students.length || parsePercent(fillAll) === null}>Set for all listed</button>
          <span className="ad-meta">{roster.students.length} students{invalid.length ? ` · ${invalid.length} invalid (use 0–100)` : ""}</span>
        </div>
        <ErrorNote message={roster.error} onRetry={loadRoster} />
        {roster.loading && !roster.students.length ? <Skeleton /> : roster.students.length ? (
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead><tr><th>Student</th><th>Batch · Section</th><th>Last updated</th><th className="actions">Attendance %</th></tr></thead>
              <tbody>
                {roster.students.map((student) => {
                  const value = drafts[student.id] ?? "";
                  const bad = String(value) !== String(student.percent ?? "") && parsePercent(value) === null;
                  return (
                    <tr key={student.id}>
                      <td>
                        <div className="ad-person">
                          <span className="ad-avatar sm">{initialsOf(student.name)}</span>
                          <div><strong>{student.name}</strong><small>{student.studentId || "No student ID"}</small></div>
                        </div>
                      </td>
                      <td><span className="ad-meta">{[student.batch && `Batch ${student.batch}`, student.section && `Sec ${student.section}`].filter(Boolean).join(" · ") || "—"}</span></td>
                      <td className="nowrap"><span className="ad-meta">{student.updatedAt ? shortDate(student.updatedAt) : "Not set"}</span></td>
                      <td className="actions">
                        <input
                          className={`ad-input ad-att-percent ${bad ? "invalid" : ""}`}
                          type="number" min={0} max={100} step={1} inputMode="numeric"
                          value={value}
                          onChange={(event) => setDrafts((current) => ({ ...current, [student.id]: event.target.value }))}
                          aria-label={`Attendance percentage for ${student.name}`}
                          aria-invalid={bad}
                        /> %
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty icon="users" title="No matching students">Try a different batch, section or search.</Empty>}
      </Card>
    </div>
  );
}

// ---------- Courses ----------
const EMPTY_COURSE = { code: "", title: "", department: "", credits: 3 };

function Courses() {
  const { toast } = useConsole();
  const { data, error, loading, reload, setData } = useResource("/api/admin/courses");
  const [department, setDepartment] = useState("");
  const [editing, setEditing] = useState(null); // EMPTY_COURSE to add, a course to edit
  const departments = useMemo(() => [...new Set((data || []).map((course) => course.department).filter(Boolean))].sort(), [data]);
  const courses = (data || []).filter((course) => !department || course.department === department);

  function saved(course, isNew) {
    setData((list) => (isNew ? [...(list || []), course] : list.map((item) => (item.id === course.id ? course : item))));
    setEditing(null);
    toast(`${course.code} ${isNew ? "added" : "updated"}.`);
  }

  return (
    <div className="ad-stack">
      <div className="ad-chips">
        {[["", "All", data?.length || 0], ...departments.map((key) => [key, key, (data || []).filter((course) => course.department === key).length])].map(([key, label, count]) => (
          <button key={label} type="button" className={`ad-chip ${department === key ? "active" : ""}`} onClick={() => setDepartment(key)}>{label}<b>{count}</b></button>
        ))}
      </div>
      <Card
        title="Courses"
        subtitle="Teachers take attendance for their department's courses"
        actions={<button type="button" className="ad-btn primary" onClick={() => setEditing(EMPTY_COURSE)}><Icon name="plus" size={16} /> Add course</button>}
      >
        <ErrorNote message={error} onRetry={reload} />
        {loading && !data ? <Skeleton /> : courses.length ? (
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead><tr><th>Code</th><th>Title</th><th>Department</th><th className="num">Credits</th><th className="actions">Actions</th></tr></thead>
              <tbody>
                {courses.map((course) => (
                  <tr key={course.id}>
                    <td className="nowrap"><strong>{course.code}</strong></td>
                    <td>{course.title}</td>
                    <td><Badge>{course.department || "—"}</Badge></td>
                    <td className="num">{course.credits}</td>
                    <td className="actions"><button type="button" className="ad-icon-btn" title="Edit course" aria-label={`Edit ${course.code}`} onClick={() => setEditing(course)}><Icon name="edit" size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon="book" title="No courses yet">Add a course so teachers can take attendance.</Empty>}
      </Card>
      <BatchAssignments courses={data || []} />
      {editing && <CourseModal course={editing} departments={departments} onClose={() => setEditing(null)} onSaved={saved} />}
    </div>
  );
}

function CourseModal({ course, departments, onClose, onSaved }) {
  const isNew = !course.id;
  const [form, setForm] = useState({ code: course.code, title: course.title, department: course.department || "", credits: course.credits });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await request(isNew ? "/api/admin/courses" : `/api/admin/courses/${course.id}`, { method: isNew ? "POST" : "PATCH", body: form });
      onSaved(result, isNew);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }
  return (
    <Modal
      title={isNew ? "Add a course" : `Edit ${course.code}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="ad-btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="ad-course" className="ad-btn primary" disabled={saving}>{saving ? "Saving…" : isNew ? "Add course" : "Save changes"}</button>
        </>
      )}
    >
      <form id="ad-course" className="ad-form" onSubmit={submit}>
        <Field label="Course code" hint="e.g. CSE401"><input value={form.code} onChange={set("code")} required maxLength={20} autoFocus /></Field>
        <Field label="Department" hint="e.g. CSE, ENG, BBA">
          <input value={form.department} onChange={set("department")} required maxLength={40} list="ad-course-departments" />
          <datalist id="ad-course-departments">{departments.map((key) => <option key={key} value={key} />)}</datalist>
        </Field>
        <Field label="Title" wide><input value={form.title} onChange={set("title")} required maxLength={120} /></Field>
        <Field label="Credits"><input type="number" min={0} max={6} step={1} value={form.credits} onChange={set("credits")} required /></Field>
        {error && <div className="ad-alert ad-alert-error" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}
      </form>
    </Modal>
  );
}

// Assigning a course to a batch enrols every student of that batch in the course's department.
function BatchAssignments({ courses }) {
  const { toast, confirm } = useConsole();
  const { data, error, loading, reload, setData } = useResource("/api/admin/course-batches");
  const [code, setCode] = useState("");
  const [batch, setBatch] = useState("");
  const [saving, setSaving] = useState(false);
  const course = courses.find((item) => item.code.toLowerCase() === code.trim().replace(/\s+/g, "").toLowerCase());

  async function assign(event) {
    event.preventDefault();
    if (!course) return toast(`No course with code ${code.trim() || "…"}. Add it above first.`, "error");
    setSaving(true);
    try {
      const row = await request("/api/admin/course-batches", { method: "POST", body: { courseId: course.id, batch } });
      setData((list) => [...(list || []), row]);
      toast(`${row.course.code} assigned to batch ${row.batch} · ${row.studentCount} student${row.studentCount === 1 ? "" : "s"}.`);
      setCode("");
      setBatch("");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(row) {
    const ok = await confirm({ title: "Remove from batch?", message: `${row.course.code} will disappear from the courses of batch ${row.batch}'s students.`, confirmLabel: "Remove", danger: true });
    if (!ok) return;
    try {
      await request(`/api/admin/course-batches/${row.id}`, { method: "DELETE" });
      setData((list) => list.filter((item) => item.id !== row.id));
      toast(`${row.course.code} removed from batch ${row.batch}.`);
    } catch (err) {
      toast(err.message, "error");
    }
  }

  return (
    <Card title="Assign courses to batches" subtitle="Students of that batch (in the course's department) see the course on their dashboard">
      <form className="ad-toolbar" onSubmit={assign}>
        <input className="ad-input" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Course code, e.g. CSE390" aria-label="Course code" list="ad-batch-courses" required />
        <datalist id="ad-batch-courses">{courses.map((item) => <option key={item.id} value={item.code}>{item.title}</option>)}</datalist>
        <input className="ad-input" value={batch} onChange={(event) => setBatch(event.target.value)} placeholder="Batch, e.g. 60" aria-label="Batch" size={10} required />
        <button type="submit" className="ad-btn primary" disabled={saving}>{saving ? "Assigning…" : "Assign"}</button>
        <span className="ad-meta">{code.trim() ? (course ? `${course.title} · ${course.department || "all departments"}` : "Unknown course code") : ""}</span>
      </form>
      <ErrorNote message={error} onRetry={reload} />
      {loading && !data ? <Skeleton rows={2} /> : data?.length ? (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead><tr><th>Batch</th><th>Course</th><th>Department</th><th className="num">Students</th><th className="actions">Actions</th></tr></thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id}>
                  <td className="nowrap"><strong>Batch {row.batch}</strong></td>
                  <td><strong>{row.course.code}</strong><small>{row.course.title}</small></td>
                  <td><Badge>{row.course.department || "—"}</Badge></td>
                  <td className="num">{row.studentCount}</td>
                  <td className="actions"><button type="button" className="ad-btn sm ghost" onClick={() => remove(row)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty icon="users" title="No batch assignments yet">Enter a course code and a batch above.</Empty>}
    </Card>
  );
}
