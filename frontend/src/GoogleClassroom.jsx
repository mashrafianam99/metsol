import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  disconnectGoogleClassroom,
  getGoogleClassroomCoursework,
  getGoogleClassroomStatus,
  redirectToGoogleClassroomConnect,
} from "./api.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DASHBOARD_ITEM_LIMIT = 3;
const TO_DO_STATUSES = new Set(["OVERDUE", "DUE", "NO_DUE_DATE"]);

const FILTERS = [
  { id: "todo", label: "To do", match: (item) => TO_DO_STATUSES.has(item.status) },
  { id: "lab", label: "Lab work", match: (item) => item.isLab && TO_DO_STATUSES.has(item.status) },
  { id: "done", label: "Turned in", match: (item) => item.status === "TURNED_IN" },
  { id: "all", label: "All", match: () => true },
];

const STATUS_LABELS = {
  OVERDUE: "Missing",
  DUE: "To submit",
  NO_DUE_DATE: "No due date",
  TURNED_IN: "Turned in",
};

const OAUTH_MESSAGES = {
  connected: "Google Classroom connected successfully.",
  error: "Google Classroom connection failed. Check your Google OAuth settings and try again.",
  denied: "Google Classroom access was not granted.",
};

function formatDue(dueAt) {
  if (!dueAt) return "No due date";
  const date = new Date(dueAt);
  // Show the year only when it isn't this year, so "Sep 15" from 2024 isn't mistaken for this year.
  const otherYear = date.getFullYear() !== new Date().getFullYear();
  return date.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", ...(otherYear ? { year: "numeric" } : {}), hour: "numeric", minute: "2-digit",
  });
}

function describeTimeLeft(item, now) {
  if (!item.dueAt || item.status === "TURNED_IN") return "";
  const days = Math.round((new Date(item.dueAt).getTime() - now) / DAY_MS);
  if (item.status === "OVERDUE") return days === 0 ? "Due today" : `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `in ${days} days`;
}

// Loads the connection status and the live coursework together; shared by the page and the dashboard card.
function useClassroomCoursework() {
  const [state, setState] = useState({ loading: true, status: { connected: false }, coursework: [], fetchedAt: null, error: "", errorCode: "" });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "", errorCode: "" }));
    try {
      const status = await getGoogleClassroomStatus();
      if (!status?.connected) {
        setState({ loading: false, status: { connected: false }, coursework: [], fetchedAt: null, error: "", errorCode: "" });
        return;
      }
      const data = await getGoogleClassroomCoursework();
      setState({ loading: false, status, coursework: data.coursework || [], fetchedAt: data.fetchedAt, error: "", errorCode: "" });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error.message || "Unable to load Google Classroom.",
        errorCode: error.code || "",
      }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

function ClassroomLink({ item, compact = false }) {
  const label = item.status === "TURNED_IN" ? "View in Classroom" : "Submit in Classroom";
  if (!item.link) return <span className="classroom-muted">Link unavailable</span>;
  return (
    <a
      className={compact ? "classroom-link compact" : "primary-button classroom-link"}
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label}: ${item.title}`}
    >
      {label} ↗
    </a>
  );
}

function CourseworkRow({ item, now }) {
  const timeLeft = describeTimeLeft(item, now);
  return (
    <li className={`classroom-item status-${item.status.toLowerCase()}`}>
      <div className="classroom-item-main">
        <span className="classroom-course">
          {item.courseName}{item.topic ? ` · ${item.topic}` : ""}
        </span>
        <strong>{item.title}</strong>
        <div className="classroom-tags">
          <span className={`classroom-badge ${item.status.toLowerCase()}`}>{STATUS_LABELS[item.status]}</span>
          {item.isLab && <span className="classroom-badge lab">Lab</span>}
          {item.late && item.status === "TURNED_IN" && <span className="classroom-badge overdue">Late</span>}
          {item.maxPoints && <span className="classroom-muted">{item.assignedGrade !== null && item.assignedGrade !== undefined ? `${item.assignedGrade}/` : ""}{item.maxPoints} pts</span>}
        </div>
      </div>
      <div className="classroom-item-side">
        <span className="classroom-due">{formatDue(item.dueAt)}</span>
        {timeLeft && <small className={item.status === "OVERDUE" ? "warning" : ""}>{timeLeft}</small>}
        <ClassroomLink item={item} />
      </div>
    </li>
  );
}

function NotConnected({ onConnect }) {
  return (
    <div className="classroom-empty">
      <h3>See your Classroom work here</h3>
      <p>
        Connect the Google account you use for Google Classroom. The portal will list your upcoming assignments
        and lab work with due dates. To submit, you will be taken straight to the item in Google Classroom.
      </p>
      <p className="classroom-muted">The portal only gets read-only access and never submits work on your behalf.</p>
      <button className="primary-button" onClick={onConnect}>Connect Google Classroom</button>
    </div>
  );
}

export function GoogleClassroom() {
  const { loading, status, coursework, fetchedAt, error, errorCode, reload } = useClassroomCoursework();
  const [filter, setFilter] = useState("todo");
  const [message, setMessage] = useState("");
  const now = fetchedAt ? new Date(fetchedAt).getTime() : Date.now();

  useEffect(() => {
    const connectionState = new URLSearchParams(window.location.search).get("googleClassroom");
    if (OAUTH_MESSAGES[connectionState]) {
      setMessage(OAUTH_MESSAGES[connectionState]);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const counts = useMemo(() => ({
    overdue: coursework.filter((item) => item.status === "OVERDUE").length,
    dueThisWeek: coursework.filter((item) => item.status === "DUE" && new Date(item.dueAt).getTime() - now <= 7 * DAY_MS).length,
    lab: coursework.filter((item) => item.isLab && TO_DO_STATUSES.has(item.status)).length,
    done: coursework.filter((item) => item.status === "TURNED_IN").length,
  }), [coursework, now]);

  const activeFilter = FILTERS.find((entry) => entry.id === filter) || FILTERS[0];
  const visible = coursework.filter(activeFilter.match);

  const handleConnect = async () => {
    try {
      setMessage("Opening Google sign-in...");
      await redirectToGoogleClassroomConnect();
    } catch (connectError) {
      setMessage(connectError.message || "Unable to start the Google Classroom connection.");
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectGoogleClassroom();
      setMessage("Google Classroom disconnected.");
      reload();
    } catch (disconnectError) {
      setMessage(disconnectError.message || "Unable to disconnect Google Classroom.");
    }
  };

  return (
    <section className="card classroom-page">
      <div className="card-header classroom-header">
        <div>
          <h3>Google Classroom</h3>
          <span>
            {status.connected
              ? `Connected as ${status.email || "your Google account"}${fetchedAt ? ` · updated ${new Date(fetchedAt).toLocaleTimeString()}` : ""}`
              : "Your assignments and lab work, without opening Classroom"}
          </span>
        </div>
        {status.connected && (
          <div className="classroom-actions">
            <button className="outline-button" onClick={reload} disabled={loading}>{loading ? "Refreshing..." : "Refresh"}</button>
            <button className="outline-button" onClick={handleDisconnect}>Disconnect</button>
          </div>
        )}
      </div>

      {message && <div className="form-message classroom-message" role="status">{message}</div>}
      {error && (
        <div className="form-message classroom-message" role="alert">
          {error}{" "}
          {errorCode === "RECONNECT_REQUIRED" && <button className="primary-button" onClick={handleConnect}>Reconnect</button>}
        </div>
      )}

      {loading && !coursework.length ? (
        <p className="classroom-muted">Loading your Google Classroom work...</p>
      ) : !status.connected ? (
        <NotConnected onConnect={handleConnect} />
      ) : (
        <>
          <div className="classroom-summary">
            <div><strong className={counts.overdue ? "warning" : ""}>{counts.overdue}</strong><span>Missing</span></div>
            <div><strong>{counts.dueThisWeek}</strong><span>Due in 7 days</span></div>
            <div><strong>{counts.lab}</strong><span>Lab work to do</span></div>
            <div><strong className="success">{counts.done}</strong><span>Turned in</span></div>
          </div>

          <div className="classroom-filters" role="tablist" aria-label="Filter coursework">
            {FILTERS.map((entry) => (
              <button
                key={entry.id}
                role="tab"
                aria-selected={filter === entry.id}
                className={filter === entry.id ? "active" : ""}
                onClick={() => setFilter(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {visible.length ? (
            <ul className="classroom-list">
              {visible.map((item) => <CourseworkRow key={`${item.courseId}-${item.id}`} item={item} now={now} />)}
            </ul>
          ) : (
            <p className="classroom-muted classroom-none">
              {filter === "done" ? "Nothing turned in yet." : "You're all caught up — nothing to submit here."}
            </p>
          )}
        </>
      )}
    </section>
  );
}

// Compact "what's next" card for the dashboard.
export function ClassroomUpcoming({ onOpen }) {
  const { loading, status, coursework, fetchedAt, error } = useClassroomCoursework();
  const now = fetchedAt ? new Date(fetchedAt).getTime() : Date.now();
  const next = coursework.filter((item) => TO_DO_STATUSES.has(item.status)).slice(0, DASHBOARD_ITEM_LIMIT);

  return (
    <section className="card classroom-upcoming">
      <div className="card-header">
        <div>
          <h3>Next in Google Classroom</h3>
          <span>{loading || status.connected ? "Assignments and lab work to submit" : "Connect to see your Classroom deadlines"}</span>
        </div>
        {/* Status is unknown while loading, so don't offer "Connect" to an already-connected student. */}
        {!loading && <button onClick={onOpen}>{status.connected ? "View All" : "Connect"}</button>}
      </div>
      {loading ? (
        <p className="classroom-muted">Loading...</p>
      ) : error ? (
        <p className="classroom-muted">{error}</p>
      ) : !status.connected ? (
        <p className="classroom-muted">Link your Google account once to see what is due next, right here.</p>
      ) : next.length ? (
        next.map((item) => (
          <div className="assignment-row" key={`${item.courseId}-${item.id}`}>
            <div>
              <strong>{item.isLab ? "🧪 " : ""}{item.title}</strong>
              <span>{item.courseName}</span>
            </div>
            <div className="assignment-date">
              <span>{formatDue(item.dueAt)}</span>
              <small className={item.status === "OVERDUE" ? "warning" : ""}>{describeTimeLeft(item, now) || STATUS_LABELS[item.status]}</small>
              <ClassroomLink item={item} compact />
            </div>
          </div>
        ))
      ) : (
        <p className="classroom-muted">You're all caught up. 🎉</p>
      )}
    </section>
  );
}
