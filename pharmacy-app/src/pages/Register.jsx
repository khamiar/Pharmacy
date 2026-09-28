import React from "react";
import Login from "./Login.jsx";

/**
 * Register Page
 * Re-uses the unified two-sided sliding authentication card with initialMode="register".
 * Switching between Login and Register animates the advertisement panel smoothly without page reload.
 */
export default function Register() {
  return <Login initialMode="register" />;
}
