import React, { useEffect, useState } from "react";
import { Icon } from "./icons.jsx";

// Real Metropolitan University photos (MU Photographic Society, via metrouni.edu.bd), served from /public/campus.
const CAMPUS_SLIDES = [
  { src: "/campus/mu-seminar.jpg", caption: "Seminar room, Metropolitan University" },
  { src: "/campus/mu-students.jpg", caption: "Students in session" },
];
const SLIDE_INTERVAL_MS = 6000;

const HIGHLIGHTS = [
  { icon: "chart", label: "Results & CGPA" },
  { icon: "classroom", label: "Google Classroom" },
  { icon: "bus", label: "Live transport" },
  { icon: "sparkles", label: "EduAI assistant" },
];

function CampusShowcase() {
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    const id = setInterval(() => setSlide((current) => (current + 1) % CAMPUS_SLIDES.length), SLIDE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="auth-hero" aria-label="Metropolitan University">
      {CAMPUS_SLIDES.map((item, index) => (
        <img
          key={item.src}
          src={item.src}
          alt={index === slide ? item.caption : ""}
          className={index === slide ? "auth-slide active" : "auth-slide"}
        />
      ))}
      <div className="auth-hero-shade" />

      <div className="auth-hero-content">
        <div className="auth-hero-brand">
          <span className="auth-hero-logo"><img src="/university-logo.png" alt="Metropolitan University" /></span>
        </div>

        <div className="auth-hero-copy">
          <span className="auth-kicker">Metropolitan University · Sylhet</span>
          <h2>Your whole campus,<br /><em>one sign-in away.</em></h2>
          <p>Courses, results, assignments, payments and transport — organised in a single, beautiful portal built for MU students.</p>
          <ul className="auth-highlights">
            {HIGHLIGHTS.map((item) => (
              <li key={item.label}><Icon name={item.icon} size={15} />{item.label}</li>
            ))}
          </ul>
        </div>

        <div className="auth-hero-footer">
          <div className="auth-dots" role="tablist" aria-label="Campus photos">
            {CAMPUS_SLIDES.map((item, index) => (
              <button
                key={item.src}
                type="button"
                role="tab"
                aria-selected={index === slide}
                aria-label={item.caption}
                className={index === slide ? "active" : ""}
                onClick={() => setSlide(index)}
              />
            ))}
          </div>
          <span className="auth-credit">{CAMPUS_SLIDES[slide].caption} · Photo: MU Photographic Society</span>
        </div>
      </div>
    </section>
  );
}

export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth-page">
      <CampusShowcase />
      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-mobile-logo"><img src="/university-logo.png" alt="Metropolitan University" /></div>
          <header className="auth-header">
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </header>
          {children}
        </div>
        {footer && <footer className="auth-footer">{footer}</footer>}
      </section>
    </div>
  );
}

export function TextField({ id, label, icon, ...inputProps }) {
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-input">
        {icon && <Icon name={icon} size={17} />}
        <input id={id} {...inputProps} />
      </div>
    </div>
  );
}

export function PasswordField({ id, label, value, onChange, ...inputProps }) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const detectCaps = (event) => setCapsLock(Boolean(event.getModifierState?.("CapsLock")));

  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-input">
        <Icon name="lock" size={17} />
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={onChange}
          onKeyUp={detectCaps}
          onKeyDown={detectCaps}
          onBlur={() => setCapsLock(false)}
          {...inputProps}
        />
        <button
          type="button"
          className="auth-reveal"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          <Icon name={visible ? "eyeOff" : "eye"} size={17} />
        </button>
      </div>
      {capsLock && <span className="auth-hint warn"><Icon name="alert" size={13} />Caps Lock is on</span>}
    </div>
  );
}

const STRENGTH_LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"];

export function passwordScore(password) {
  if (!password || password.length < 8) return 0;
  let score = 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(score, 4);
}

export function PasswordStrength({ password }) {
  if (!password) return null;
  const score = passwordScore(password);
  return (
    <div className={`auth-strength s${score}`} aria-live="polite">
      <div className="auth-strength-bars">{[1, 2, 3, 4].map((step) => <i key={step} className={score >= step ? "on" : ""} />)}</div>
      <span>{STRENGTH_LABELS[score]}</span>
    </div>
  );
}

export function AuthAlert({ tone = "info", children }) {
  if (!children) return null;
  return (
    <div className={`auth-alert ${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon name={tone === "error" ? "alert" : "check"} size={16} />
      <span>{children}</span>
    </div>
  );
}
