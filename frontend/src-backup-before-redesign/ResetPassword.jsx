import React, { useEffect, useState } from "react";
import { supabase } from "./supabase.js";

export const PASSWORD_RESET_PARAM = "reset-password";
const MIN_PASSWORD_LENGTH = 8;

// The URL Supabase sends the user back to from the password-reset email.
export function passwordResetRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}?${PASSWORD_RESET_PARAM}=1`;
}

export function isPasswordResetUrl() {
  return new URLSearchParams(window.location.search).has(PASSWORD_RESET_PARAM);
}

// Supabase reports expired/invalid links in the URL hash or query, e.g. #error_code=otp_expired.
function readLinkError() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const description = params.get("error_description") || query.get("error_description");
  return description ? description.replace(/\+/g, " ") : "";
}

function clearResetUrl() {
  window.history.replaceState(null, "", window.location.pathname);
}

export default function ResetPassword({ onFinished }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [isCheckingLink, setIsCheckingLink] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const linkError = readLinkError();

    // getSession waits for supabase-js to read the recovery tokens from the link.
    supabase.auth.getSession()
      .then(({ data }) => {
        if (cancelled) return;
        if (data.session) {
          setHasRecoverySession(true);
        } else {
          setError(linkError
            ? `${linkError}. Request a new password reset link.`
            : "This password reset link is invalid or has expired. Request a new one.");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Unable to verify your reset link. Check your connection and try again.");
      })
      .finally(() => {
        if (!cancelled) setIsCheckingLink(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const finish = async (message) => {
    await supabase.auth.signOut().catch(() => {});
    clearResetUrl();
    onFinished(message);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Choose a password with at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await finish("Your password has been updated. Sign in with your new password.");
    } catch (requestError) {
      setError(requestError.message || "Unable to update your password. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">🎓</div>
        <h1>Smart University</h1>
        <p className="login-subtitle">Set a new password</p>

        {error && <p className="login-error" role="alert">{error}</p>}
        {isCheckingLink && <p className="login-message" role="status">Checking your reset link...</p>}

        {hasRecoverySession && (
          <form onSubmit={handleSubmit}>
            <div className="login-field">
              <label htmlFor="reset-password">New Password</label>
              <input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={1024}
                placeholder="Enter a new password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            <div className="login-field">
              <label htmlFor="reset-confirm-password">Confirm New Password</label>
              <input
                id="reset-confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={1024}
                placeholder="Enter the new password again"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </div>
            <button type="submit" className="login-button" disabled={isSubmitting}>
              {isSubmitting ? "Updating password..." : "Update Password"}
            </button>
          </form>
        )}

        {!isCheckingLink && (
          <p className="login-switch">
            <button type="button" onClick={() => finish("")}>Back to sign in</button>
          </p>
        )}
      </div>
    </div>
  );
}
