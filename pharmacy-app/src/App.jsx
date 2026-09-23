import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import LandingPage from "./pages/LandingPage.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import ProtectedRoute from "./pages/ProtectedRoute.jsx";

import Layout from "./pages/Layout.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import CatalogPage from "./pages/CatalogPage.jsx";
import Medicine from "./pages/Medicine.jsx";
import Purchases from "./pages/Purchases.jsx";
import Suplier from "./pages/Suplier.jsx";
import { useAuth } from "./context/AuthContext";

function ModuleAccess({ permission, children }) {
  const { permissions } = useAuth();
  if (!permissions.includes(permission)) return <div className="alert alert-warning" role="alert">You do not have permission to access this module.</div>;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Protected routes - only reachable with a valid token */}
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/medicines" element={<ModuleAccess permission="medicines"><Medicine /></ModuleAccess>} />
            <Route path="/categories" element={<ModuleAccess permission="categories"><CatalogPage resource="categories" /></ModuleAccess>} />
            <Route path="/suppliers" element={<ModuleAccess permission="suppliers"><Suplier /></ModuleAccess>} />
            <Route path="/purchases" element={<ModuleAccess permission="purchases"><Purchases /></ModuleAccess>} />
            <Route path="/dashboard/medicine" element={<Navigate to="/medicines" replace />} />
            <Route path="/dashboard/suppliers" element={<Navigate to="/suppliers" replace />} />
          </Route>
        </Route>
        <Route path="*" element={<main className="container py-5"><h1>Page not found</h1><a href="/dashboard">Go to dashboard</a></main>} />
      </Routes>
    </BrowserRouter>
  );
}
