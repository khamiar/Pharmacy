import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BsCapsule,
  BsPerson,
  BsEnvelope,
  BsLock,
  BsEye,
  BsEyeSlash,
  BsTelephone,
} from "react-icons/bs";
import "./AuthPages.css";
import { registerUser, authErrorMessage } from "../services/authServices.js";

export default function Register() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [duplicate, setDuplicate] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError("");
    setDuplicate(false);

    const { fullName, email, phone, password, confirmPassword } = formData;

    if (!fullName || !email || !phone || !password || !confirmPassword) {
      setError("Tafadhali jaza taarifa zote.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Password hazifanani.");
      return;
    }
    if (new TextEncoder().encode(password).length > 72) {
      setError('Password must be at most 72 bytes. Use a shorter password.');
      return;
    }
    if (password.length < 6) {
      setError("Password iwe angalau herufi/namba 6.");
      return;
    }

    setLoading(true);
    try {
      const {confirmPassword, ...userData} = formData; // Exclude confirmPassword from the data sent to the server

      await registerUser(userData);


      navigate("/login", { state: { email: formData.email.trim().toLowerCase(), registered: true } });

    } catch (err) {
      setDuplicate(err.response?.status === 409);
      setError(authErrorMessage(err, "Registration failed. Please try again."));
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
          <h4 className="auth-title mb-1">Create Account</h4>
          <p className="auth-subtitle mb-0">
            Register to start using the pharmacy system
          </p>
        </div>

        {error && (
          <div className="alert alert-danger py-2 small" role="alert">
            {error}
            {duplicate && <Link to="/login" state={{ email: formData.email.trim().toLowerCase() }} className="d-block auth-link mt-2">Sign in to this account</Link>}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label htmlFor="fullName" className="form-label small fw-semibold">
              Full Name
            </label>
            <div className="input-group input-group-pharmacy">
              <span className="input-group-text">
                <BsPerson />
              </span>
              <input
                type="text"
                className="form-control"
                id="fullName"
                name="fullName"
                autoComplete="name"
                maxLength={150}
                required
                placeholder="Full Name"
                value={formData.fullName}
                onChange={handleChange}
              />
            </div>
          </div>

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
                maxLength={150}
                required
                placeholder="you@pharmacy.com"
                value={formData.email}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className="mb-3">
            <label htmlFor="phone" className="form-label small fw-semibold">
              Phone Number
            </label>
            <div className="input-group input-group-pharmacy">
              <span className="input-group-text">
                <BsTelephone />
              </span>
              <input
                type="tel"
                className="form-control"
                id="phone"
                name="phone"
                autoComplete="tel"
                maxLength={30}
                required
                placeholder="+255 7XX XXX XXX"
                value={formData.phone}
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
                autoComplete="new-password"
                minLength={6}
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

          <div className="mb-3">
            <label
              htmlFor="confirmPassword"
              className="form-label small fw-semibold"
            >
              Confirm Password
            </label>
            <div className="input-group input-group-pharmacy">
              <span className="input-group-text">
                <BsLock />
              </span>
              <input
                type={showPassword ? "text" : "password"}
                className="form-control"
                id="confirmPassword"
                name="confirmPassword"
                autoComplete="new-password"
                required
                placeholder="••••••••"
                value={formData.confirmPassword}
                onChange={handleChange}
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-pharmacy-primary w-100 py-2 mt-2"
            disabled={loading}
          >
            {loading ? "Inasajili..." : "Register"}
          </button>
        </form>

        <p className="text-center small text-muted mt-4 mb-0">
          Already have an account?{" "}
          <Link to="/login" className="auth-link">
            Login here
          </Link>
        </p>
      </div>
    </div>
  );
}
