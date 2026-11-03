import React, { useState } from "react";
import { apiFetch } from "./api.js";
import { supabase } from "./supabase.js";

export default function Login({ onLogin, message = "" }) {
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
        if (signUpError) throw new Error(signUpError.message);
        if (!data.session) {
          // Email confirmation is enabled in Supabase: the user must confirm before signing in.
          setIsRegistering(false);
          setPassword("");
          setConfirmPassword("");
          setNotice("Account created. Check your email and confirm your address, then sign in.");
          return;
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (signInError) throw new Error(signInError.message);
      }

      // The backend verifies the Supabase session and returns the portal profile (role, student ID, ...).
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
          ? "Sign in failed. Make sure your email address is confirmed."
          : responseError || "The server could not load your profile. Please try again.");
      }
      onLogin(await response.json());
    } catch (requestError) {
      setError(
        requestError instanceof TypeError
          ? "Unable to reach the server. Check that the backend is running and your API URL is configured."
          : requestError.message || `Unable to ${isRegistering ? "create your account" : "sign in"}. Please try again.`
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">🎓</div>
        <h1>Smart University</h1>
        <p className="login-subtitle">{isRegistering ? "Create your student account" : "Student Portal"}</p>

        {message && <p className="login-message" role="status">{message}</p>}
        {notice && <p className="login-message" role="status">{notice}</p>}
        {error && <p className="login-error" role="alert">{error}</p>}
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
                onClick={() => setError("Password recovery is not configured yet. Contact your administrator.")}
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