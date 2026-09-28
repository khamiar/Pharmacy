import React, { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "../components/SideBar";
import Header from "../components/Header";
import "../index.css";

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 767px)").matches,
  );
  const menuButton = useRef(null);
  const drawer = useRef(null);
  const location = useLocation();
  const closeDrawer = () => setMobileOpen(false);
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const reset = () => {
      setMobileOpen(false);
      setIsMobile(media.matches);
    };
    media.addEventListener("change", reset);
    return () => media.removeEventListener("change", reset);
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawer.current?.querySelector("button, a")?.focus();
    const trap = (event) => {
      if (event.key === "Escape") closeDrawer();
      if (event.key !== "Tab") return;
      const elements = [
        ...drawer.current.querySelectorAll("a[href], button:not([disabled])"),
      ].filter((node) => node.getClientRects().length);
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", trap);
      menuButton.current?.focus();
    };
  }, [mobileOpen]);
  return (
    <div
      className={`pharmacy-app ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "drawer-open" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {mobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={closeDrawer}
          aria-hidden="true"
        />
      )}
      <Sidebar
        drawerRef={drawer}
        mobileOpen={mobileOpen}
        closeDrawer={closeDrawer}
      />
      <div className="app-content" inert={mobileOpen ? "" : undefined}>
        <Header
          menuButton={menuButton}
          expanded={isMobile ? mobileOpen : !collapsed}
          toggleSidebar={() => {
            if (isMobile) setMobileOpen(!mobileOpen);
            else setCollapsed(!collapsed);
          }}
        />
        <main id="main-content" tabIndex={-1} className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
