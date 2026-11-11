import { supabase } from "./supabase.js";

const configuredApiUrl = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

export function apiUrl(path) {
  return `${configuredApiUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

// Supabase keeps the session (and refreshes the access token) for us.
export async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || "";
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new Error("Unable to sign you out. Please try again.");
  }
}

// Parses a JSON body without throwing on plain-text responses (e.g. "Unauthorized" or rate-limit messages).
export async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

// The connect endpoint requires the bearer token, which a plain browser navigation cannot send,
// so we fetch the Google consent URL first and then navigate to it.
export async function redirectToGoogleClassroomConnect() {
  const response = await apiFetch("/api/google/classroom/connect");
  const data = await readJson(response);
  if (!response.ok || !data.url) {
    throw new Error(data.error || "Unable to start the Google Classroom connection.");
  }
  window.location.href = data.url;
}

export async function getGoogleClassroomStatus() {
  const response = await apiFetch("/api/google/classroom/status");
  if (!response.ok) {
    throw new Error("Unable to read Google Classroom connection status.");
  }
  return response.json();
}

export async function disconnectGoogleClassroom() {
  const response = await apiFetch("/api/google/classroom/disconnect", { method: "POST" });
  if (!response.ok) {
    throw new Error("Unable to disconnect Google Classroom.");
  }
  return response.json();
}

// Returns the student's live Classroom coursework. Errors carry a code: NOT_CONNECTED or RECONNECT_REQUIRED.
export async function getGoogleClassroomCoursework() {
  const response = await apiFetch("/api/google/classroom/coursework");
  const data = await readJson(response);
  if (!response.ok) {
    const error = new Error(data.error || "Unable to load your Google Classroom coursework.");
    error.code = data.code;
    throw error;
  }
  return data;
}

export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers);
  const token = await getAccessToken();

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(apiUrl(path), { ...options, headers });
}
