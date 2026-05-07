/**
 * Layout — main authenticated shell
 *
 * Responsive behaviour:
 *   Phone   (< 768px / md)  : sidebar is an overlay drawer; hamburger in top-bar
 *   Tablet  (768–1023px)    : sidebar auto-collapses to icon-only (w-14)
 *   Desktop (≥ 1024px / lg) : sidebar fully expanded (w-60); toggle button available
 *
 * Collapse state is persisted in localStorage so it survives page refresh.
 */
import React, { useState, useEffect, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useGetIdentity, useLogout } from "@refinedev/core";
import { useCompanySettings } from "../context/CompanySettingsContext";
import { supabaseClient } from "../supabaseClient";

interface StaffIdentity {
  id:        string;
  name:      string;
  role:      string;
  job_title: string;
  avatar:    string;
}

const NAV_ITEMS: {
  path:     string;
  label:    string;
  icon:     string;
  minRoles: string[];
}[] = [
  { path: "/",               label: "Dashboard",       icon: "🏠", minRoles: ["Admin","HR","Leader","Sales","Logistics"] },
  { path: "/clients",        label: "Clients",         icon: "👥", minRoles: ["Admin","HR","Leader","Sales"] },
  { path: "/products",       label: "Products",        icon: "📦", minRoles: ["Admin","HR","Leader","Sales"] },
  { path: "/purchase-orders",label: "Purchase Orders", icon: "🛒", minRoles: ["Admin","HR"] },
  { path: "/invoices",       label: "Invoices",        icon: "🧾", minRoles: ["Admin","HR","Leader","Sales"] },
  { path: "/delivery-orders",label: "Delivery Orders", icon: "🚚", minRoles: ["Admin","HR","Leader","Sales","Logistics"] },
  { path: "/hr",             label: "HR",              icon: "🏢", minRoles: ["Admin","HR"] },
  { path: "/playbook",       label: "Playbook",        icon: "📚", minRoles: ["Admin","HR","Leader","Sales"] },
  { path: "/reports",        label: "Reports",         icon: "📊", minRoles: ["Admin","HR","Leader"] },
  { path: "/settings",       label: "Settings",        icon: "⚙️", minRoles: ["Admin"] },
];

const ROLE_ORDER = ["Admin","HR","Leader","Sales","Logistics"];

function hasAccess(userRole: string, minRoles: string[]): boolean {
  const userRank = ROLE_ORDER.indexOf(userRole);
  return minRoles.some((r) => ROLE_ORDER.indexOf(r) === userRank || minRoles.includes(userRole));
}

interface LayoutProps { children: ReactNode }

export default function Layout({ children }: LayoutProps) {
  const { data: identity } = useGetIdentity<StaffIdentity>();
  const { mutate: logout } = useLogout();
  const navigate           = useNavigate();
  const { settings }       = useCompanySettings();

  const userRole   = identity?.role ?? "Sales";
  const visibleNav = NAV_ITEMS.filter((item) => item.minRoles.includes(userRole));

  // ── Sidebar state ─────────────────────────────────────────────────────────
  // sidebarOpen:    mobile drawer visibility
  // collapsed:      icon-only mode (desktop/tablet)
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed,   setCollapsed]   = useState<boolean>(() => {
    const stored = localStorage.getItem("sidebar-collapsed");
    if (stored !== null) return stored === "true";
    // Default: collapsed on tablet (< 1024px), expanded on desktop
    return window.innerWidth < 1024;
  });

  // Close mobile drawer on resize to desktop
  useEffect(() => {
    const handler = () => {
      if (window.innerWidth >= 768) setSidebarOpen(false);
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const toggleCollapse = () => {
    setCollapsed((v) => {
      localStorage.setItem("sidebar-collapsed", String(!v));
      return !v;
    });
  };

  // ── Change Password modal ─────────────────────────────────────────────────
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [newPwd,        setNewPwd]        = useState("");
  const [confirmPwd,    setConfirmPwd]    = useState("");
  const [pwdMsg,        setPwdMsg]        = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isChangingPwd, setIsChangingPwd] = useState(false);

  const openChangePwd = () => {
    setNewPwd(""); setConfirmPwd(""); setPwdMsg(null);
    setShowChangePwd(true);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdMsg(null);
    if (newPwd.length < 8) {
      setPwdMsg({ type: "error", text: "Password must be at least 8 characters." });
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdMsg({ type: "error", text: "Passwords do not match." });
      return;
    }
    setIsChangingPwd(true);
    const { error } = await supabaseClient.auth.updateUser({ password: newPwd });
    setIsChangingPwd(false);
    if (error) {
      setPwdMsg({ type: "error", text: error.message });
    } else {
      setPwdMsg({ type: "success", text: "Password updated! Please use your new password next time." });
      setTimeout(() => setShowChangePwd(false), 2500);
    }
  };

  // ── Sidebar width classes ─────────────────────────────────────────────────
  // Mobile: fixed overlay, full width (w-60) — always show labels when drawer is open
  // Desktop: w-14 (collapsed) or w-60 (expanded)
  const sidebarWidthClass = collapsed ? "w-14" : "w-60";

  return (
    <div className="flex h-screen bg-surface overflow-hidden">

      {/* ── Mobile backdrop ────────────────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside
        className={[
          // Base styles
          "flex flex-col bg-brand-900 text-white shrink-0 transition-all duration-300 ease-in-out",
          // Mobile: fixed overlay drawer
          "fixed inset-y-0 left-0 z-50",
          // Desktop: part of normal flex flow
          "md:relative md:z-auto",
          // Mobile visibility: slide in/out
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          // Width
          sidebarWidthClass,
        ].join(" ")}
      >
        {/* Logo / Company name + collapse toggle */}
        <div
          className={[
            "flex items-center border-b border-brand-800 min-h-[60px] overflow-hidden",
            collapsed ? "justify-center px-2 py-3" : "gap-2 px-4 py-3",
          ].join(" ")}
        >
          {!collapsed && (
            settings.logo_url ? (
              <img
                src={settings.logo_url}
                alt={settings.company_name}
                className="h-9 w-auto object-contain flex-1 min-w-0"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <span className="text-lg font-bold tracking-tight truncate flex-1">
                {settings.company_name}
              </span>
            )
          )}

          {/* Collapse / expand toggle — desktop only */}
          <button
            onClick={toggleCollapse}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={[
              "hidden md:flex items-center justify-center rounded-lg transition-colors",
              "text-brand-300 hover:text-white hover:bg-brand-800",
              collapsed ? "w-9 h-9" : "w-7 h-7 ml-auto shrink-0",
            ].join(" ")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4"
            >
              {collapsed ? (
                /* chevron-right */
                <path fillRule="evenodd" d="M7.293 4.293a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              ) : (
                /* chevron-left */
                <path fillRule="evenodd" d="M12.707 4.293a1 1 0 010 1.414L8.414 10l4.293 4.293a1 1 0 01-1.414 1.414l-5-5a1 1 0 010-1.414l5-5a1 1 0 011.414 0z" clipRule="evenodd" />
              )}
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden">
          <ul className={collapsed ? "space-y-0.5 px-1" : "space-y-0.5 px-2"}>
            {visibleNav.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end={item.path === "/"}
                  onClick={() => setSidebarOpen(false)}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    [
                      "flex items-center rounded-lg transition-colors text-sm font-medium",
                      collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2",
                      isActive
                        ? "bg-brand-700 text-white"
                        : "text-brand-200 hover:bg-brand-800 hover:text-white",
                    ].join(" ")
                  }
                >
                  <span className="text-base shrink-0">{item.icon}</span>
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* User footer */}
        <div className="border-t border-brand-800 p-3">
          {identity ? (
            collapsed ? (
              /* Collapsed: just avatar + actions stacked */
              <div className="flex flex-col items-center gap-2">
                <img
                  src={identity.avatar}
                  alt={identity.name}
                  className="w-8 h-8 rounded-full"
                  title={`${identity.name} (${identity.role})`}
                />
                <button
                  onClick={openChangePwd}
                  className="text-brand-300 hover:text-white transition-colors text-xs"
                  title="Change password"
                >
                  🔑
                </button>
                <button
                  onClick={() => logout()}
                  className="text-brand-300 hover:text-white transition-colors text-xs"
                  title="Sign out"
                >
                  ⏻
                </button>
              </div>
            ) : (
              /* Expanded: full row */
              <div className="flex items-center gap-3">
                <img
                  src={identity.avatar}
                  alt={identity.name}
                  className="w-8 h-8 rounded-full shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{identity.name}</p>
                  <p className="text-xs text-brand-300 truncate">{identity.role}</p>
                </div>
                <button
                  onClick={openChangePwd}
                  className="text-brand-300 hover:text-white transition-colors text-xs shrink-0"
                  title="Change password"
                >
                  🔑
                </button>
                <button
                  onClick={() => logout()}
                  className="text-brand-300 hover:text-white transition-colors text-xs shrink-0"
                  title="Sign out"
                >
                  ⏻
                </button>
              </div>
            )
          ) : (
            <div className="skeleton h-10 w-full" />
          )}
        </div>
      </aside>

      {/* ── Change Password Modal ─────────────────────────────────────────── */}
      {showChangePwd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowChangePwd(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900">Change Password</h2>
              <button
                onClick={() => setShowChangePwd(false)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              >×</button>
            </div>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">New Password</label>
                <input
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  required
                  minLength={8}
                  autoFocus
                  placeholder="Min. 8 characters"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm
                             focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  required
                  placeholder="Repeat new password"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm
                             focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>
              {pwdMsg && (
                <p className={`text-xs rounded-lg px-3 py-2 border ${
                  pwdMsg.type === "success"
                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                    : "bg-red-50 text-red-700 border-red-200"
                }`}>
                  {pwdMsg.type === "success" ? "✅" : "❌"} {pwdMsg.text}
                </p>
              )}
              <button
                type="submit"
                disabled={isChangingPwd}
                className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold
                           rounded-lg py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isChangingPwd ? "Updating…" : "Update Password"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Main content area ───────────────────────────────────────────────── */}
      {/*
        On mobile: sidebar is `fixed` (out of flow) so this div takes full width.
        On desktop: sidebar is `relative` (in flow) so this div takes remaining width.
      */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-14 flex items-center gap-3 px-4 md:px-6 bg-white border-b border-gray-200 shrink-0">
          {/* Hamburger — mobile only */}
          <button
            className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg
                       text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
              strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
            </svg>
          </button>

          <h1 className="text-sm font-semibold text-gray-700 flex-1 min-w-0 truncate" />

          <div className="flex items-center gap-3 shrink-0">
            {identity && (
              <span className="text-xs font-medium bg-brand-100 text-brand-700 px-2.5 py-1 rounded-full">
                {identity.role}
              </span>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
