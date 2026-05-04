/**
 * ResetPasswordPage — handles Supabase password reset links
 * Supabase emails a link → user lands here → set new password.
 *
 * Flow:
 *   1. User clicks link in email → lands at /reset-password#access_token=...&type=recovery
 *   2. supabaseClient (detectSessionInUrl: true) auto-picks up the recovery session
 *   3. We show a "Set New Password" form
 *   4. Call supabaseClient.auth.updateUser({ password }) → success → redirect to /login
 */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabaseClient } from "../../supabaseClient";
import { useCompanySettings } from "../../context/CompanySettingsContext";

export function ResetPasswordPage() {
  const navigate           = useNavigate();
  const { settings }       = useCompanySettings();

  const [newPwd,      setNewPwd]      = useState("");
  const [confirmPwd,  setConfirmPwd]  = useState("");
  const [status,      setStatus]      = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error,       setError]       = useState<string | null>(null);
  const [hasSession,  setHasSession]  = useState<boolean | null>(null); // null = checking

  // Supabase sets the session from the URL hash automatically (detectSessionInUrl: true).
  // We just need to verify a session exists before showing the form.
  useEffect(() => {
    supabaseClient.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
    });

    // Also listen for the AUTH_TOKEN_REFRESHED / SIGNED_IN event that Supabase
    // fires when it parses the recovery token from the URL hash
    const { data: listener } = supabaseClient.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setHasSession(true);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPwd.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPwd !== confirmPwd) {
      setError("Passwords do not match.");
      return;
    }

    setStatus("loading");
    const { error: updateErr } = await supabaseClient.auth.updateUser({ password: newPwd });

    if (updateErr) {
      setStatus("error");
      setError(updateErr.message);
      return;
    }

    setStatus("success");
    // Sign out so the user logs in fresh with their new password
    await supabaseClient.auth.signOut();
    setTimeout(() => navigate("/login"), 2500);
  };

  // ── Loading check ─────────────────────────────────────────────────────────────
  if (hasSession === null) {
    return (
      <div className="min-h-screen bg-brand-900 flex items-center justify-center">
        <p className="text-brand-300 text-sm">Verifying reset link…</p>
      </div>
    );
  }

  // ── Expired / invalid link ────────────────────────────────────────────────────
  if (!hasSession) {
    return (
      <div className="min-h-screen bg-brand-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center">
          <p className="text-4xl mb-3">⚠️</p>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Link Expired</h2>
          <p className="text-sm text-gray-500 mb-6">
            This password reset link has expired or has already been used.
            Please request a new one.
          </p>
          <button
            onClick={() => navigate("/login")}
            className="text-brand-600 hover:text-brand-700 text-sm font-medium transition-colors"
          >
            ← Back to Sign In
          </button>
        </div>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-brand-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Branding */}
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

          {status === "success" ? (
            /* ── Success state ── */
            <div className="text-center space-y-3 py-4">
              <p className="text-4xl">✅</p>
              <p className="text-lg font-bold text-gray-900">Password Updated!</p>
              <p className="text-sm text-gray-500">
                Your new password is active. Redirecting to sign in…
              </p>
            </div>
          ) : (
            /* ── Form ── */
            <>
              <h2 className="text-xl font-semibold text-gray-900 mb-1">Set New Password</h2>
              <p className="text-sm text-gray-500 mb-6">
                Choose a strong password for your account.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    New Password
                  </label>
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
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    Confirm Password
                  </label>
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

                {error && (
                  <p className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg px-3 py-2">
                    ❌ {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={status === "loading"}
                  className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold
                             rounded-lg py-2.5 text-sm transition-colors mt-2
                             disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {status === "loading" ? "Updating…" : "Set New Password"}
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
