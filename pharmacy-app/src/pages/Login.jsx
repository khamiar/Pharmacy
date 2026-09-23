import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import {
  BsCapsule,
  BsEnvelope,
  BsLock,
  BsEye,
  BsEyeSlash,
} from "react-icons/bs";
import "./AuthPages.css";
import { loginUser, authErrorMessage } from "../services/authServices.js";

export default function Login() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({ email: state?.email || "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError("");

    if (!formData.email || !formData.password) {
      setError("Please fill in all fields.");
      return;
    }

    setLoading(true);
    try {
      const data = await loginUser(formData);

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));

      navigate("/dashboard");

    } catch (err) {
      setError(authErrorMessage(err, "Login failed. Please check your email and password."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="text-center mb-4">
          <div className="auth-logo-circle">
            <BsCapsule />
          </div>
          <h4 className="auth-title mb-1">Welcome Back</h4>
          <p className="auth-subtitle mb-0">Login to your pharmacy account</p>
        </div>

        {state?.registered && <div className="alert alert-success" role="status">Account created. Sign in with your password.</div>}
        {error && (
          <div className="alert alert-danger py-2 small" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label htmlFor="email" className="form-label small fw-semibold">
              Email
            </label>
            <div className="input-group input-group-pharmacy">
              <span className="input-group-text">
                <BsEnvelope />
              </span>
              <input
                type="email"
                className="form-control"
                id="email"
                name="email"
                autoComplete="email"
                required
                placeholder="you@pharmacy.com"
                value={formData.email}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className="mb-3">
            <label htmlFor="password" className="form-label small fw-semibold">
              Password
            </label>
            <div className="input-group input-group-pharmacy">
              <span className="input-group-text">
                <BsLock />
              </span>
              <input
                type={showPassword ? "text" : "password"}
                className="form-control"
                id="password"
                name="password"
                autoComplete="current-password"
                required
                placeholder="••••••••"
                value={formData.password}
                onChange={handleChange}
              />
              <button
                type="button"
                className="btn password-toggle-btn"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <BsEyeSlash /> : <BsEye />}
              </button>
            </div>
          </div>

          <div className="d-flex justify-content-between align-items-center mb-3">
            <div className="form-check">
              <input
                type="checkbox"
                className="form-check-input"
                id="remember"
              />
              <label
                className="form-check-label small text-muted"
                htmlFor="remember"
              >
                Remember me
              </label>
            </div>
            <span className="small text-muted">Forgot your password? Contact your administrator.</span>
          </div>

          <button
            type="submit"
            className="btn btn-pharmacy-primary w-100 py-2"
            disabled={loading}
          >
            {loading ? "Inaingia..." : "Login"}
          </button>
        </form>

        <p className="text-center small text-muted mt-4 mb-0">
          Don't have an account?{" "}
          <Link to="/register" className="auth-link">
            Register here
          </Link>
        </p>
      </div>
    </div>
  );
}
