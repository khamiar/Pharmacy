import React, { useCallback, useEffect, useState } from "react";
import { Navigate, Outlet, useNavigate } from "react-router-dom";
import { getProfile } from "../services/authServices";
import { AuthContext } from "../context/AuthContext";

export default function ProtectedRoute() {
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const token = localStorage.getItem("token");
  const logout = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setSession(null);
    navigate("/login", { replace: true });
  }, [navigate]);
  useEffect(() => {
    if (!token) return;
    let active = true;
    setError("");
    getProfile(token)
      .then((data) => {
        if (active) setSession(data);
      })
      .catch((err) => {
        if (!active) return;
        if ([401, 404].includes(err.response?.status)) {
          localStorage.removeItem("token");
          localStorage.removeItem("user");
          navigate("/login", {
            replace: true,
            state: { sessionMessage: err.response?.data?.message },
          });
        } else
          setError(
            "We could not verify your session. Check your connection and try again.",
          );
      });
    return () => {
      active = false;
    };
  }, [token, attempt, navigate]);
  useEffect(() => {
    const sync = (event) => {
      if (event.key === "token" || event.key === null) {
        setSession(null);
        setAttempt((value) => value + 1);
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  if (!token) return <Navigate to="/login" replace />;
  if (error)
    return (
      <main className="container py-5">
        <div role="alert" className="alert alert-danger">
          {error}
        </div>
        <button
          className="btn btn-success me-2"
          onClick={() => setAttempt(attempt + 1)}
        >
          Retry
        </button>
        <button className="btn btn-outline-secondary" onClick={logout}>
          Back to login
        </button>
      </main>
    );
  if (!session)
    return (
      <main className="container py-5" role="status">
        Verifying your session…
      </main>
    );
  return (
    <AuthContext.Provider value={{ ...session, logout }}>
      <Outlet />
    </AuthContext.Provider>
  );
}
