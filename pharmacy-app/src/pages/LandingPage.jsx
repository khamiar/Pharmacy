import React from "react";
import { Link } from "react-router-dom";
import {
  BsCapsule,
  BsShieldCheck,
  BsClockHistory,
  BsGraphUp,
} from "react-icons/bs";
import "./AuthPages.css";

export default function LandingPage() {
  return (
    <div className="landing-hero">
      {/* Navbar */}
      <nav className="navbar navbar-expand-lg landing-navbar px-4 px-lg-5 py-3">
        <div className="container-fluid px-0">
          <a className="navbar-brand d-flex align-items-center gap-2" href="/">
            <BsCapsule size={26} />
            <span className="fs-5">Pharmacy System</span>
          </a>
          <div className="d-flex gap-2">
            <Link to="/login" className="btn btn-pharmacy-outline btn-sm">
              Login
            </Link>
            <Link to="/register" className="btn btn-pharmacy-primary btn-sm">
              Register
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero content */}
      <div className="landing-content container px-4 px-lg-5">
        <div className="row align-items-center g-5">
          <div className="col-lg-7">
            <span className="landing-badge mb-3 bg-dark">
              <BsShieldCheck className="text-success" /> Trusted pharmacy management
            </span>
            <h1 className="landing-title mt-3 mb-3">
              Manage your pharmacy inventory, sales and staff, all in one
              place.
            </h1>
            <p className="landing-subtitle mb-4">
              A simple, reliable system to track medicine stock, record
              sales, manage suppliers and keep your pharmacy running
              smoothly, every day.
            </p>
            <div className="d-flex flex-wrap gap-3">
              <Link to="/register" className="btn btn-pharmacy-primary btn-lg">
                Get Started
              </Link>
              <Link to="/login" className="btn btn-pharmacy-outline btn-lg">
                I already have an account
              </Link>
            </div>
          </div>

          <div className="col-lg-5">
            <div className="row g-3">
              <div className="col-6">
                <div className="landing-feature-card h-100">
                  <div className="landing-feature-icon">
                    <BsCapsule />
                  </div>
                  <h6 className="fw-semibold mb-1">Stock Tracking</h6>
                  <small className="text-white-50">
                    Know what's in stock, always.
                  </small>
                </div>
              </div>
              <div className="col-6">
                <div className="landing-feature-card h-100">
                  <div className="landing-feature-icon">
                    <BsGraphUp />
                  </div>
                  <h6 className="fw-semibold mb-1">Sales Reports</h6>
                  <small className="text-white-50">
                    Daily, weekly and monthly insights.
                  </small>
                </div>
              </div>
              <div className="col-6">
                <div className="landing-feature-card h-100">
                  <div className="landing-feature-icon">
                    <BsClockHistory />
                  </div>
                  <h6 className="fw-semibold mb-1">Expiry Alerts</h6>
                  <small className="text-white-50">
                    Never miss an expiring batch.
                  </small>
                </div>
              </div>
              <div className="col-6">
                <div className="landing-feature-card h-100">
                  <div className="landing-feature-icon">
                    <BsShieldCheck />
                  </div>
                  <h6 className="fw-semibold mb-1">Secure Access</h6>
                  <small className="text-white-50">
                    Role-based staff accounts.
                  </small>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer strip
      <div className="text-center py-3">
        <small className="text-white-50">
          &copy; {new Date().getFullYear()} Pharmacy System. All rights reserved.
        </small>
      </div> */}
    </div>
  );
}
