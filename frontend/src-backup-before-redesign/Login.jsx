import React, { useState } from "react";
import { apiFetch } from "./api.js";
import { supabase } from "./supabase.js";
import { passwordResetRedirectUrl } from "./ResetPassword.jsx";

function ForgotPasswordForm({ initialEmail, onBack }) {
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setError("Please enter your email address.");
      return;
    }

    setIsSending(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: passwordResetRedirectUrl(),
      });
      if (resetError) throw resetError;
      // Same message whether or not the account exists, so the form cannot be used to probe emails.
      setNotice("If an account exists for this email, a password reset link is on its way. Check your inbox and spam folder.");
    } catch (requestError) {
      setError(requestError.message || "Unable to send the reset email. Please try again.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">🎓</div>
        <h1>Smart University</h1>
        <p className="login-subtitle">Reset your password</p>

        {notice && <p className="login-message" role="status">{notice}</p>}
        {error && <p className="login-error" role="alert">{error}</p>}

        <form onSubmit={handleSubmit}>
          <div className="login-field">
            <label htmlFor="forgot-email">Email Address</label>
            <input
              id="forgot-email"
              type="email"
              autoComplete="email"
              placeholder="Enter your university email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <button type="submit" className="login-button" disabled={isSending}>
            {isSending ? "Sending reset link..." : "Send Reset Link"}
          </button>
        </form>

        <p className="login-switch">
          Remembered it? <button type="button" onClick={onBack}>Back to sign in</button>
        </p>
      </div>
    </div>
  );
}

export default function Login({ onLogin, message = "" }) {
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [studentId, setStudentId] = useState("");
  const [department, setDepartment] = useState("");
  const [batch, setBatch] = useState("");
  const [section, setSection] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState("");
  const [isResendingConfirmation, setIsResendingConfirmation] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");

    const normalizedEmail = email.trim();
    if (isRegistering && !name.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (!normalizedEmail || !password) {
      setError("Please enter your email and password.");
      return;
    }
    if (isRegistering && (!studentId.trim() || !department.trim() || !batch.trim() || !section.trim())) {
      setError("Please complete your student ID, department, batch, and section.");
      return;
    }
    if (isRegistering && password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    if (isRegistering && password.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isRegistering) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: {
              name: name.trim(),
              studentId: studentId.trim(),
              department: department.trim(),
              batch: batch.trim(),
              section: section.trim(),
            },
          },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          // Email confirmation is enabled in Supabase: the user must confirm before signing in.
          setIsRegistering(false);
          setPassword("");
          setConfirmPassword("");
          setPendingConfirmationEmail(normalizedEmail);
          setNotice("Account created. Check your inbox and spam folder for a confirmation email.");
          return;
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (signInError) throw signInError;
      }

      // The backend verifies the Supabase session and returns the portal profile (role, student ID, ...).
      setPendingConfirmationEmail("");
      const response = await apiFetch("/api/me");
      if (!response.ok) {
        await supabase.auth.signOut();
        let responseError;
        try {
          responseError = (await response.json()).error;
        } catch {
          responseError = "";
        }
        throw new Error(response.status === 401
          ? "Sign in failed: your session could not be verified. Please try again."
          : responseError || "The server could not load your profile. Please try again.");
      }
      onLogin(await response.json());
    } catch (requestError) {
      // Supabase wraps network failures as AuthRetryableFetchError ("Failed to fetch"); fetch itself throws TypeError.
      const isNetworkError = requestError instanceof TypeError
        || requestError?.name === "AuthRetryableFetchError"
        || /failed to fetch|networkerror|load failed/iu.test(requestError?.message || "");
      setError(
        isNetworkError
          ? "Unable to reach the server. Check your connection, that the backend is running, and that the Supabase project is active."
          : requestError.message || `Unable to ${isRegistering ? "create your account" : "sign in"}. Please try again.`
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendConfirmation = async () => {
    setError("");
    setNotice("");
    setIsResendingConfirmation(true);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: pendingConfirmationEmail,
      });
      if (resendError) throw resendError;
      setNotice("Confirmation email requested again. Check your inbox and spam folder.");
    } catch (requestError) {
      setError(requestError.message || "Unable to resend the confirmation email. Please try again.");
    } finally {
      setIsResendingConfirmation(false);
    }
  };

  if (isForgotPassword) {
    return (
      <ForgotPasswordForm
        initialEmail={email.trim()}
        onBack={() => {
          setIsForgotPassword(false);
          setError("");
          setNotice("");
        }}
      />
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">🎓</div>
        <h1>Smart University</h1>
        <p className="login-subtitle">{isRegistering ? "Create your student account" : "Student Portal"}</p>

        {message && <p className="login-message" role="status">{message}</p>}
        {notice && <p className="login-message" role="status">{notice}</p>}
        {error && <p className="login-error" role="alert">{error}</p>}
        {pendingConfirmationEmail && pendingConfirmationEmail === email.trim() && !isRegistering && (
          <button
            type="button"
            className="forgot-password login-resend"
            onClick={handleResendConfirmation}
            disabled={isResendingConfirmation}
          >
            {isResendingConfirmation ? "Sending..." : "Resend confirmation email"}
          </button>
        )}
        <form onSubmit={handleSubmit}>
          {isRegistering && (
            <div className="login-field">
              <label htmlFor="login-name">Full Name</label>
              <input
                id="login-name"
                type="text"
                autoComplete="name"
                maxLength={100}
                placeholder="Enter your full name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
          )}

          <div className="login-field">
            <label htmlFor="login-email">Email Address</label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              placeholder="Enter your university email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          {isRegistering && (
            <div className="login-registration-grid">
              <div className="login-field">
                <label htmlFor="login-student-id">Student ID</label>
                <input
                  id="login-student-id"
                  type="text"
                  autoComplete="off"
                  maxLength={50}
                  placeholder="Enter your student ID"
                  value={studentId}
                  onChange={(event) => setStudentId(event.target.value)}
                  required
                />
              </div>
              <div className="login-field">
                <label htmlFor="login-department">Department</label>
                <input
                  id="login-department"
                  type="text"
                  autoComplete="organization-title"
                  maxLength={100}
                  placeholder="Enter your department"
                  value={department}
                  onChange={(event) => setDepartment(event.target.value)}
                  required
                />
              </div>
              <div className="login-field">
                <label htmlFor="login-batch">Batch</label>
                <input
                  id="login-batch"
                  type="text"
                  autoComplete="off"
                  maxLength={50}
                  placeholder="Enter your batch"
                  value={batch}
                  onChange={(event) => setBatch(event.target.value)}
                  required
                />
              </div>
              <div className="login-field">
                <label htmlFor="login-section">Section</label>
                <input
                  id="login-section"
                  type="text"
                  autoComplete="off"
                  maxLength={50}
                  placeholder="Enter your section"
                  value={section}
                  onChange={(event) => setSection(event.target.value)}
                  required
                />
              </div>
            </div>
          )}

          <div className="login-field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              autoComplete={isRegistering ? "new-password" : "current-password"}
              minLength={isRegistering ? 8 : undefined}
              maxLength={1024}
              placeholder="Enter your password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          {isRegistering && (
            <div className="login-field">
              <label htmlFor="login-confirm-password">Confirm Password</label>
              <input
                id="login-confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={1024}
                placeholder="Enter your password again"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </div>
          )}

          <div className="login-options">
            <span />

            {!isRegistering && (
              <button
                type="button"
                className="forgot-password"
                onClick={() => {
                  setError("");
                  setNotice("");
                  setIsForgotPassword(true);
                }}
              >
                Forgot Password?
              </button>
            )}
          </div>

          <button type="submit" className="login-button" disabled={isSubmitting}>
            {isSubmitting ? (isRegistering ? "Creating account..." : "Signing in...") : (isRegistering ? "Create Account" : "Sign In")}
          </button>
        </form>

        <p className="login-switch">
          {isRegistering ? "Already have an account?" : "New to the portal?"}{" "}
          <button
            type="button"
            onClick={() => {
              setIsRegistering(!isRegistering);
              setError("");
            }}
          >
            {isRegistering ? "Sign in" : "Create an account"}
          </button>
        </p>

        <div className="login-footer">
          <p>Smart University Student Portal</p>
          <span>Secure · Modern · Connected</span>
        </div>
      </div>
    </div>
  );
}