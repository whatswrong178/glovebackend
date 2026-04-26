/**
 * LoginPage — Supabase email/password auth
 * Simple, zero-friction B2B login form.
 */
import React, { useState } from "react";
import { useLogin } from "@refinedev/core";
import { useCompanySettings } from "../../context/CompanySettingsContext";

interface LoginFormValues {
  email:    string;
  password: string;
}

export function LoginPage() {
  const { mutate: login, isLoading } = useLogin<LoginFormValues>();
  const { settings } = useCompanySettings();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState<string | null>(null);

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
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-brand-400">
          Access restricted to authorised {settings.company_name} staff only.
        </p>
      </div>
    </div>
  );
}
