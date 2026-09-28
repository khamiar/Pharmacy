import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  BsCapsule,
  BsEnvelope,
  BsLock,
  BsEye,
  BsEyeSlash,
  BsPerson,
  BsTelephone,
  BsShieldCheck,
  BsCheck2,
} from "react-icons/bs";
import "./AuthPages.css";
import {
  loginUser,
  registerUser,
  authErrorMessage,
} from "../services/authServices.js";

/**
 * Unified Two-Sided Sliding Authentication Card
 * Login and Register live entirely inside this single component.
 * Switching between Login and Register smoothly slides the image banner across to the other side.
 */
export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();

  // Mode: false = Login, true = Register
  const [isRegister, setIsRegister] = useState(() => {
    return window.location.pathname === "/register";
  });

  // Listen for browser Back / Forward history navigation
  useEffect(() => {
    const handlePopState = () => {
      setIsRegister(window.location.pathname === "/register");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Login form state
  const [loginData, setLoginData] = useState({
    email: location.state?.email || "",
    password: "",
  });
  const [loginShowPassword, setLoginShowPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [sessionMessage, setSessionMessage] = useState(
    location.state?.sessionMessage || ""
  );
  const [registeredNotice, setRegisteredNotice] = useState(
    location.state?.registered || false
  );
  const [forgotNotice, setForgotNotice] = useState(false);

  // Register form state
  const [registerData, setRegisterData] = useState({
    fullName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [registerShowPassword, setRegisterShowPassword] = useState(false);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerError, setRegisterError] = useState("");
  const [duplicateEmail, setDuplicateEmail] = useState(false);

  // In-place smooth animation switches
  const handleSwitchToRegister = (e) => {
    e?.preventDefault();
    setIsRegister(true);
    setLoginError("");
    setRegisterError("");
    setForgotNotice(false);
    window.history.replaceState(null, "", "/register");
  };

  const handleSwitchToLogin = (e) => {
    e?.preventDefault();
    setIsRegister(false);
    setLoginError("");
    setRegisterError("");
    setForgotNotice(false);
    window.history.replaceState(null, "", "/login");
  };

  // Login Form Submission
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    if (loginLoading) return;
    setLoginError("");
    setSessionMessage("");
    setForgotNotice(false);

    if (!loginData.email || !loginData.password) {
      setLoginError("Please enter both your email and password.");
      return;
    }

    setLoginLoading(true);
    try {
      const data = await loginUser(loginData);
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      navigate("/dashboard");
    } catch (err) {
      setLoginError(
        authErrorMessage(
          err,
          "Login failed. Please check your credentials and try again."
        )
      );
    } finally {
      setLoginLoading(false);
    }
  };

  // Register Form Submission
  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    if (registerLoading) return;
    setRegisterError("");
    setDuplicateEmail(false);

    const { fullName, email, phone, password, confirmPassword } = registerData;

    if (!fullName || !email || !phone || !password || !confirmPassword) {
      setRegisterError("Please fill in all registration fields.");
      return;
    }
    if (password !== confirmPassword) {
      setRegisterError("Passwords do not match.");
      return;
    }
    if (new TextEncoder().encode(password).length > 72) {
      setRegisterError("Password must be at most 72 bytes. Use a shorter password.");
      return;
    }
    if (password.length < 6) {
      setRegisterError("Password must be at least 6 characters long.");
      return;
    }

    setRegisterLoading(true);
    try {
      const { confirmPassword: _, ...payload } = registerData;
      await registerUser(payload);

      // On successful registration:
      // Slide back to Login side smoothly, prefill email, and show approval notice
      setLoginData((prev) => ({
        ...prev,
        email: registerData.email.trim().toLowerCase(),
      }));
      setRegisteredNotice(true);
      setIsRegister(false);
      window.history.replaceState(null, "", "/login");

      setRegisterData({
        fullName: "",
        email: "",
        phone: "",
        password: "",
        confirmPassword: "",
      });
    } catch (err) {
      if (err.response?.status === 409) {
        setDuplicateEmail(true);
      }
      setRegisterError(
        authErrorMessage(err, "Registration failed. Please try again.")
      );
    } finally {
      setRegisterLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className={`auth-container ${isRegister ? "register-mode" : ""}`}>
        {/* ====================================================
            PANEL 1: Register Form (Positioned on the Left Half)
            ==================================================== */}
        <div className="auth-form-panel register-side">
          <div className="auth-header">
            <div className="auth-logo-badge">
              <BsCapsule />
            </div>
            <h3 className="auth-main-title">Create Account</h3>
            <p className="auth-sub-desc">
              Register for administrator approval
            </p>
          </div>

          {registerError && (
            <div className="alert alert-danger py-2 px-3 small mb-2" role="alert">
              {registerError}
              {duplicateEmail && (
                <div className="mt-1">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger"
                    onClick={() => {
                      setLoginData((prev) => ({
                        ...prev,
                        email: registerData.email.trim().toLowerCase(),
                      }));
                      handleSwitchToLogin();
                    }}
                  >
                    Sign in with this email
                  </button>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleRegisterSubmit}>
            <div className="form-group-field compact">
              <label htmlFor="reg-fullName" className="field-label">
                Full Name
              </label>
              <div className="custom-input-box">
                <span className="input-icon-wrap">
                  <BsPerson />
                </span>
                <input
                  type="text"
                  id="reg-fullName"
                  name="fullName"
                  className="custom-input-field"
                  placeholder="e.g. Dr. John Doe"
                  maxLength={150}
                  required
                  value={registerData.fullName}
                  onChange={(e) =>
                    setRegisterData({ ...registerData, fullName: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="form-group-field compact">
              <label htmlFor="reg-email" className="field-label">
                Email Address
              </label>
              <div className="custom-input-box">
                <span className="input-icon-wrap">
                  <BsEnvelope />
                </span>
                <input
                  type="email"
                  id="reg-email"
                  name="email"
                  className="custom-input-field"
                  placeholder="pharmacist@pharmacy.com"
                  maxLength={150}
                  required
                  value={registerData.email}
                  onChange={(e) =>
                    setRegisterData({ ...registerData, email: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="form-group-field compact">
              <label htmlFor="reg-phone" className="field-label">
                Phone Number
              </label>
              <div className="custom-input-box">
                <span className="input-icon-wrap">
                  <BsTelephone />
                </span>
                <input
                  type="tel"
                  id="reg-phone"
                  name="phone"
                  className="custom-input-field"
                  placeholder="+255 7XX XXX XXX"
                  maxLength={30}
                  required
                  value={registerData.phone}
                  onChange={(e) =>
                    setRegisterData({ ...registerData, phone: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="form-group-field compact">
              <label htmlFor="reg-password" className="field-label">
                Password
              </label>
              <div className="custom-input-box">
                <span className="input-icon-wrap">
                  <BsLock />
                </span>
                <input
                  type={registerShowPassword ? "text" : "password"}
                  id="reg-password"
                  name="password"
                  className="custom-input-field"
                  placeholder="At least 6 characters"
                  minLength={6}
                  required
                  value={registerData.password}
                  onChange={(e) =>
                    setRegisterData({ ...registerData, password: e.target.value })
                  }
                />
                <button
                  type="button"
                  className="password-eye-btn"
                  onClick={() => setRegisterShowPassword(!registerShowPassword)}
                  aria-label="Toggle password visibility"
                  tabIndex={-1}
                >
                  {registerShowPassword ? <BsEyeSlash /> : <BsEye />}
                </button>
              </div>
            </div>

            <div className="form-group-field compact">
              <label htmlFor="reg-confirmPassword" className="field-label">
                Confirm Password
              </label>
              <div className="custom-input-box">
                <span className="input-icon-wrap">
                  <BsLock />
                </span>
                <input
                  type={registerShowPassword ? "text" : "password"}
                  id="reg-confirmPassword"
                  name="confirmPassword"
                  className="custom-input-field"
                  placeholder="Repeat your password"
                  required
                  value={registerData.confirmPassword}
                  onChange={(e) =>
                    setRegisterData({
                      ...registerData,
                      confirmPassword: e.target.value,
                    })
                  }
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn-auth-submit"
              disabled={registerLoading}
            >
              {registerLoading ? "Submitting Registration..." : "Register Account"}
            </button>
          </form>

          <p className="auth-switch-prompt">
            Already have an account?
            <button
              type="button"
              className="auth-switch-btn"
              onClick={handleSwitchToLogin}
            >
              Sign In here
            </button>
          </p>

          <p className="auth-copyright">
            © 2026 Pharmacy Management System
          </p>
        </div>

        {/* ====================================================
            PANEL 2: Login Form (Positioned on the Right Half)
            ==================================================== */}
        <div className="auth-form-panel login-side">
          <div className="auth-header">
            <div className="auth-logo-badge">
              <BsCapsule />
            </div>
            <h3 className="auth-main-title">Pharmacy Portal</h3>
            <p className="auth-sub-desc">
              Sign in to continue to your account
            </p>
          </div>

          {sessionMessage && (
            <div className="alert alert-warning py-2 px-3 small mb-3" role="alert">
              {sessionMessage}
            </div>
          )}

          {registeredNotice && (
            <div className="alert alert-success py-2 px-3 small mb-3" role="status">
              Registration submitted! An administrator will review your account before activation. You can sign in once approved.
            </div>
          )}

          {loginError && (
            <div className="alert alert-danger py-2 px-3 small mb-3" role="alert">
              {loginError}
            </div>
          )}

          {forgotNotice && (
            <div className="alert alert-info py-2 px-3 small mb-3" role="alert">
              To reset your credentials, please contact your pharmacy system administrator.
            </div>
          )}

          <form onSubmit={handleLoginSubmit}>
            <div className="form-group-field">
              <label htmlFor="login-email" className="field-label">
                Email or Username
              </label>
              <div className="custom-input-box">
                <span className="input-icon-wrap">
                  <BsEnvelope />
                </span>
                <input
                  type="email"
                  id="login-email"
                  name="email"
                  className="custom-input-field"
                  autoComplete="email"
                  required
                  placeholder="pharmacist@pharmacy.com"
                  value={loginData.email}
                  onChange={(e) =>
                    setLoginData({ ...loginData, email: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="form-group-field">
              <label htmlFor="login-password" className="field-label">
                Password
              </label>
              <div className="custom-input-box">
                <span className="input-icon-wrap">
                  <BsLock />
                </span>
                <input
                  type={loginShowPassword ? "text" : "password"}
                  id="login-password"
                  name="password"
                  className="custom-input-field"
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  value={loginData.password}
                  onChange={(e) =>
                    setLoginData({ ...loginData, password: e.target.value })
                  }
                />
                <button
                  type="button"
                  className="password-eye-btn"
                  onClick={() => setLoginShowPassword(!loginShowPassword)}
                  aria-label="Toggle password visibility"
                  tabIndex={-1}
                >
                  {loginShowPassword ? <BsEyeSlash /> : <BsEye />}
                </button>
              </div>
            </div>

            <div className="d-flex justify-content-between align-items-center mb-3">
              <div className="form-check m-0">
                <input
                  type="checkbox"
                  className="form-check-input"
                  id="login-remember"
                  defaultChecked
                />
                <label
                  className="form-check-label small text-muted"
                  htmlFor="login-remember"
                >
                  Remember me
                </label>
              </div>
              <button
                type="button"
                className="forgot-link-btn"
                onClick={() => setForgotNotice(true)}
              >
                Forgot password?
              </button>
            </div>

            <button
              type="submit"
              className="btn-auth-submit"
              disabled={loginLoading}
            >
              {loginLoading ? "Signing In..." : "Sign In"}
            </button>
          </form>

          <p className="auth-switch-prompt">
            Don't have an account?
            <button
              type="button"
              className="auth-switch-btn"
              onClick={handleSwitchToRegister}
            >
              Register here
            </button>
          </p>

          <p className="auth-copyright">
            © 2026 Pharmacy Management System
          </p>
        </div>

        {/* ====================================================
            PANEL 3: SLIDING IMAGE / ADVERTISEMENT OVERLAY
            Smoothly slides Left <-> Right with CSS transform
            ==================================================== */}
        <div className="auth-slider-overlay">
          <div className="auth-slider-bg"></div>
          <div className="auth-slider-inner">
            <div className="ad-content-wrapper">
              <div className="ad-badge-pill">
                <span className="ad-pill-dot"></span>
                {isRegister ? "HEALTHCARE NETWORK" : "PHARMACY SYSTEM"}
              </div>

              <h2 className="ad-title">
                {isRegister
                  ? "Join Our Certified Healthcare Network"
                  : "Smart Healthcare & Pharmacy Operations"}
              </h2>

              <p className="ad-subtitle">
                {isRegister
                  ? "Create your staff account for verified access. All registrations are approved by pharmacy administrators."
                  : "Secure access to inventory batch tracking, prescription dispensing, and real-time pharmacy records."}
              </p>

              <div className="ad-features-list">
                <div className="ad-feature-item">
                  <span className="ad-feature-icon">
                    <BsCheck2 />
                  </span>
                  <span>
                    {isRegister
                      ? "Protected role-based authorization"
                      : "First-Expired First-Out (FEFO) dispensing"}
                  </span>
                </div>
                <div className="ad-feature-item">
                  <span className="ad-feature-icon">
                    <BsCheck2 />
                  </span>
                  <span>
                    {isRegister
                      ? "Full operations audit trail & security"
                      : "Integrated Point-of-Sale with receipts"}
                  </span>
                </div>
                <div className="ad-feature-item">
                  <span className="ad-feature-icon">
                    <BsShieldCheck />
                  </span>
                  <span>
                    {isRegister
                      ? "Quick approval notifications"
                      : "Real-time stock alerts & reports"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

