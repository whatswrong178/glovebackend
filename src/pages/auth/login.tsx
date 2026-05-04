/**
 * LoginPage — Supabase email/password auth
 * Includes Forgot Password flow via Supabase resetPasswordForEmail.
 */
import React, { useState } from "react";
import { useLogin } from "@refinedev/core";
import { useCompanySettings } from "../../context/CompanySettingsContext";
import { supabaseClient } from "../../supabaseClient";

interface LoginFormValues {
  email:    string;
  password: string;
}

export function LoginPage() {
  const { mutate: login, isLoading } = useLogin<LoginFormValues>();
  const { settings } = useCompanySettings();

  // ── Login form state ─────────────────────────────────────────────────────────
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState<string | null>(null);

  // ── Forgot password state ─────────────────────────────────────────────────────
  const [showForgot,   setShowForgot]   = useState(false);
  const [forgotEmail,  setForgotEmail]  = useState("");
  const [forgotStatus, setForgotStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [forgotError,  setForgotError]  = useState<string | null>(null);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    login(
      { email, password },
      {
        onError: (err) => {
          setError(err?.message ?? "Login failed. Check your credentials.");
        },
      }
    );
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotStatus("sending");
    setForgotError(null);
    const { error: resetErr } = await supabaseClient.auth.resetPasswordForEmail(
      forgotEmail,
      { redirectTo: `${window.location.origin}/reset-password` }
    );
    if (resetErr) {
      setForgotStatus("error");
      setForgotError(resetErr.message);
    } else {
      setForgotStatus("sent");
    }
  };

  const backToLogin = () => {
    setShowForgot(false);
    setForgotEmail("");
    setForgotStatus("idle");
    setForgotError(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-brand-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo / Company branding */}
        <div className="text-center mb-8">
          {settings.logo_url ? (
            <img
              src={settings.logo_url}
              alt={settings.company_name}
              className="h-14 w-auto object-contain mx-auto mb-3"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : null}
          <h1 className="text-3xl font-bold text-white tracking-tight">
            {settings.company_name}
          </h1>
          <p className="mt-1 text-brand-300 text-sm">Supply Chain ERP</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">

          {/* ══ FORGOT PASSWORD VIEW ══ */}
          {showForgot ? (
            <>
              <button
                onClick={backToLogin}
                className="text-xs text-brand-600 hover:text-brand-700 mb-4 flex items-center gap-1"
              >
                ← Back to Sign In
              </button>

              <h2 className="text-xl font-semibold text-gray-900 mb-1">Forgot Password</h2>
              <p className="text-sm text-gray-500 mb-6">
                Enter your work email and we'll send you a reset link.
              </p>

              {forgotStatus === "sent" ? (
                <div className="text-center space-y-3 py-4">
                  <p className="text-4xl">📬</p>
                  <p className="font-semibold text-gray-900">Check your email</p>
                  <p className="text-sm text-gray-500">
                    A password reset link has been sent to <strong>{forgotEmail}</strong>.
                    It expires in 1 hour.
                  </p>
                  <button
                    onClick={backToLogin}
                    className="mt-4 text-sm text-brand-600 hover:text-brand-700 font-medium"
                  >
                    ← Back to Sign In
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div>
                    <label
                      htmlFor="forgot-email"
                      className="block text-xs font-medium text-gray-600 mb-1.5"
                    >
                      Work Email
                    </label>
                    <input
                      id="forgot-email"
                      type="email"
                      required
                      autoFocus
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm
                                 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                      placeholder="you@company.com"
                    />
                  </div>

                  {forgotStatus === "error" && forgotError && (
                    <p className="text-danger text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      {forgotError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={forgotStatus === "sending"}
                    className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold
                               rounded-lg py-2.5 text-sm transition-colors mt-2
                               disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {forgotStatus === "sending" ? "Sending…" : "Send Reset Link"}
                  </button>
                </form>
              )}
            </>
          ) : (

          /* ══ LOGIN VIEW ══ */
            <>
              <h2 className="text-xl font-semibold text-gray-900 mb-6">Sign in</h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Email */}
                <div>
                  <label
                    htmlFor="email"
                    className="block text-xs font-medium text-gray-600 mb-1.5"
                  >
                    Work Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm
                               focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    placeholder="you@company.com"
                  />
                </div>

                {/* Password */}
                <div>
                  <label
                    htmlFor="password"
                    className="block text-xs font-medium text-gray-600 mb-1.5"
                  >
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm
                               focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    placeholder="••••••••"
                  />
                </div>

                {/* Error */}
                {error && (
                  <p className="text-danger text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold
                             rounded-lg py-2.5 text-sm transition-colors mt-2"
                >
                  {isLoading ? "Signing in…" : "Sign in"}
                </button>

                {/* Forgot password link */}
                <button
                  type="button"
                  onClick={() => { setShowForgot(true); setForgotEmail(email); }}
                  className="w-full text-center text-xs text-gray-400 hover:text-brand-600 transition-colors pt-1"
                >
                  Forgot your password?
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-brand-400">
          Access restricted to authorised {settings.company_name} staff only.
        </p>
      </div>
    </div>
  );
}
