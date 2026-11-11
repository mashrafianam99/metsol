import React, { useState } from "react";
import { apiFetch } from "./api.js";
import { supabase } from "./supabase.js";
import { passwordResetRedirectUrl } from "./ResetPassword.jsx";
import { AuthAlert, AuthLayout, PasswordField, PasswordStrength, TextField } from "./AuthLayout.jsx";
import { Icon } from "./icons.jsx";

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
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your university email and we'll send you a secure reset link."
      footer={<span>Smart University Student Portal · Secure · Modern · Connected</span>}
    >
      <AuthAlert tone="success">{notice}</AuthAlert>
      <AuthAlert tone="error">{error}</AuthAlert>

      <form className="auth-form" onSubmit={handleSubmit}>
        <TextField
          id="forgot-email"
          label="Email address"
          icon="mail"
          type="email"
          autoComplete="email"
          placeholder="you@metrouni.edu.bd"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <button type="submit" className="auth-submit" disabled={isSending}>
          {isSending ? <span className="auth-spinner" /> : null}
          {isSending ? "Sending reset link…" : "Send reset link"}
        </button>
      </form>

      <p className="auth-switch">
        Remembered it? <button type="button" onClick={onBack}>Back to sign in</button>
      </p>
    </AuthLayout>
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

  const switchMode = (registering) => {
    setIsRegistering(registering);
    setError("");
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

  const passwordsMismatch = isRegistering && confirmPassword && password !== confirmPassword;

  return (
    <AuthLayout
      title={isRegistering ? "Create your account" : "Welcome back"}
      subtitle={isRegistering
        ? "Join the Smart University portal with your student details."
        : "Sign in to continue to your student portal."}
      footer={<span>Smart University Student Portal · Secure · Modern · Connected</span>}
    >
      <div className="auth-tabs" role="tablist" aria-label="Account">
        <button type="button" role="tab" aria-selected={!isRegistering} className={!isRegistering ? "active" : ""} onClick={() => switchMode(false)}>
          Sign in
        </button>
        <button type="button" role="tab" aria-selected={isRegistering} className={isRegistering ? "active" : ""} onClick={() => switchMode(true)}>
          Create account
        </button>
        <span className="auth-tabs-indicator" style={{ transform: `translateX(${isRegistering ? 100 : 0}%)` }} aria-hidden="true" />
      </div>

      <AuthAlert tone="info">{message}</AuthAlert>
      <AuthAlert tone="success">{notice}</AuthAlert>
      <AuthAlert tone="error">{error}</AuthAlert>
      {pendingConfirmationEmail && pendingConfirmationEmail === email.trim() && !isRegistering && (
        <button
          type="button"
          className="auth-link-button"
          onClick={handleResendConfirmation}
          disabled={isResendingConfirmation}
        >
          {isResendingConfirmation ? "Sending…" : "Resend confirmation email"}
        </button>
      )}

      <form className="auth-form" onSubmit={handleSubmit} key={isRegistering ? "register" : "signin"}>
        {isRegistering && (
          <TextField
            id="login-name"
            label="Full name"
            icon="user"
            type="text"
            autoComplete="name"
            maxLength={100}
            placeholder="Your full name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        )}

        <TextField
          id="login-email"
          label="Email address"
          icon="mail"
          type="email"
          autoComplete="email"
          placeholder="you@metrouni.edu.bd"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />

        {isRegistering && (
          <div className="auth-grid">
            <TextField
              id="login-student-id"
              label="Student ID"
              icon="idCard"
              type="text"
              autoComplete="off"
              maxLength={50}
              placeholder="e.g. 232-115-001"
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
              required
            />
            <TextField
              id="login-department"
              label="Department"
              icon="layers"
              type="text"
              autoComplete="organization-title"
              maxLength={100}
              placeholder="e.g. CSE"
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              required
            />
            <TextField
              id="login-batch"
              label="Batch"
              type="text"
              autoComplete="off"
              maxLength={50}
              placeholder="e.g. 58"
              value={batch}
              onChange={(event) => setBatch(event.target.value)}
              required
            />
            <TextField
              id="login-section"
              label="Section"
              type="text"
              autoComplete="off"
              maxLength={50}
              placeholder="e.g. A"
              value={section}
              onChange={(event) => setSection(event.target.value)}
              required
            />
          </div>
        )}

        <PasswordField
          id="login-password"
          label="Password"
          autoComplete={isRegistering ? "new-password" : "current-password"}
          minLength={isRegistering ? 8 : undefined}
          maxLength={1024}
          placeholder={isRegistering ? "At least 8 characters" : "Your password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {isRegistering && <PasswordStrength password={password} />}

        {isRegistering && (
          <PasswordField
            id="login-confirm-password"
            label="Confirm password"
            autoComplete="new-password"
            minLength={8}
            maxLength={1024}
            placeholder="Repeat your password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            aria-invalid={passwordsMismatch || undefined}
            required
          />
        )}
        {passwordsMismatch && <span className="auth-hint error"><Icon name="alert" size={13} />Passwords don't match yet</span>}

        {!isRegistering && (
          <div className="auth-row">
            <span className="auth-secure"><Icon name="shield" size={14} />Secured by Supabase Auth</span>
            <button
              type="button"
              className="auth-link-button"
              onClick={() => {
                setError("");
                setNotice("");
                setIsForgotPassword(true);
              }}
            >
              Forgot password?
            </button>
          </div>
        )}

        <button type="submit" className="auth-submit" disabled={isSubmitting}>
          {isSubmitting && <span className="auth-spinner" />}
          {isSubmitting ? (isRegistering ? "Creating account…" : "Signing in…") : (isRegistering ? "Create account" : "Sign in")}
          {!isSubmitting && <Icon name="arrowRight" size={17} />}
        </button>
      </form>

      <p className="auth-switch">
        {isRegistering ? "Already have an account?" : "New to the portal?"}{" "}
        <button type="button" onClick={() => switchMode(!isRegistering)}>
          {isRegistering ? "Sign in" : "Create an account"}
        </button>
      </p>
    </AuthLayout>
  );
}
