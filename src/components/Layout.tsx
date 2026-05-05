/**
 * Layout — main authenticated shell
 * Sidebar navigation + top bar + role-aware menu filtering
 */
import React, { useState, type ReactNode } from "react";
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

// Menu items gated by minimum required role
const NAV_ITEMS: {
  path:       string;
  label:      string;
  icon:       string;
  minRoles:   string[];
}[] = [
  { path: "/",               label: "Dashboard",       icon: "🏠", minRoles: ["Admin","HR","Leader","Sales","Logistics"] },
  { path: "/clients",        label: "Clients",         icon: "👥", minRoles: ["Admin","HR","Leader","Sales"] },
  { path: "/products",        label: "Products",        icon: "📦", minRoles: ["Admin","HR","Leader","Sales"] },
  { path: "/purchase-orders",label: "Purchase Orders", icon: "🛒", minRoles: ["Admin","HR"] },
  { path: "/invoices",        label: "Invoices",        icon: "🧾", minRoles: ["Admin","HR","Leader","Sales"] },
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

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { data: identity }    = useGetIdentity<StaffIdentity>();
  const { mutate: logout }    = useLogout();
  const navigate              = useNavigate();
  const { settings }          = useCompanySettings();

  const userRole   = identity?.role ?? "Sales";
  const visibleNav = NAV_ITEMS.filter((item) => item.minRoles.includes(userRole));

  // ── Change Password modal state ──────────────────────────────────────────────
  const [showChangePwd,  setShowChangePwd]  = useState(false);
  const [newPwd,         setNewPwd]         = useState("");
  const [confirmPwd,     setConfirmPwd]     = useState("");
  const [pwdMsg,         setPwdMsg]         = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isChangingPwd,  setIsChangingPwd]  = useState(false);

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

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="w-60 flex flex-col bg-brand-900 text-white shrink-0">
        {/* Logo / Company name */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-brand-800 min-h-[60px]">
          {settings.logo_url ? (
            <img
              src={settings.logo_url}
              alt={settings.company_name}
              className="h-9 w-auto object-contain"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <>
              <span className="text-lg font-bold tracking-tight truncate">
                {settings.company_name}
              </span>
              <span className="text-xs bg-brand-700 rounded px-1.5 py-0.5 font-medium shrink-0">ERP</span>
            </>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 overflow-y-auto">
          <ul className="space-y-0.5 px-2">
            {visibleNav.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end={item.path === "/"}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-brand-700 text-white"
                        : "text-brand-200 hover:bg-brand-800 hover:text-white"
                    }`
                  }
                >
                  <span className="text-base">{item.icon}</span>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* User footer */}
        <div className="border-t border-brand-800 p-4">
          {identity ? (
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
          ) : (
            <div className="skeleton h-10 w-full" />
          )}
        </div>
      </aside>

      {/* ── Change Password Modal ────────────────────────────────────────────── */}
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

      {/* ── Main content area ─────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-14 flex items-center justify-between px-6 bg-white border-b border-gray-200 shrink-0">
          <h1 className="text-sm font-semibold text-gray-700">
            {/* Breadcrumb rendered by each page via DocumentTitleHandler */}
          </h1>
          <div className="flex items-center gap-4">
            {/* Role badge */}
            {identity && (
              <span className="text-xs font-medium bg-brand-100 text-brand-700 px-2.5 py-1 rounded-full">
                {identity.role}
              </span>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
