// ══════════════════════════════════════════════════════════════════════════════
// src/pages/hr/create.tsx — Create Staff (Admin / HR only)
// MediGlove ERP · EPIC-02 / T-02.1
//
// Flow:
//   1. Insert staff row via Refine useCreate (Supabase RLS-safe)
//   2. Call Edge Function create-staff-user to:
//      a. Create Supabase Auth user (service role)
//      b. Link auth_user_id on the staff row
//      c. Email credentials to the new staff member
//   3. Show result banner, then navigate to staff list
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState } from "react";
import { useCreate, useList, useNavigation, useGetIdentity } from "@refinedev/core";
import { useForm } from "react-hook-form";
import type { Staff, StaffRole, StaffFormValues } from "../../types/staff";
import { ROLE_META } from "../../types/staff";
import { supabaseClient } from "../../supabaseClient";

const DEPARTMENTS = [
  "Sales",
  "Finance",
  "Operations",
  "Logistics",
  "Human Resources",
  "Management",
  "IT",
];

type CredentialStatus =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "success"; emailSent: boolean; warning?: string }
  | { state: "error"; message: string };

export function HRCreatePage() {
  const { data: identity } = useGetIdentity<{ role: StaffRole }>();
  const { list }           = useNavigation();
  const { mutate: createStaff, isLoading: isCreating } = useCreate<Staff>();
  const [credStatus, setCredStatus] = useState<CredentialStatus>({ state: "idle" });

  // Fetch all active staff who could be leaders (role = Leader or Admin)
  const { data: leaderOptions } = useList<Staff>({
    resource: "staff",
    filters:  [
      { field: "status", operator: "eq",  value: "Active"  },
      { field: "role",   operator: "in",  value: ["Leader","Admin"] },
    ],
    sorters:  [{ field: "name", order: "asc" }],
    pagination: { mode: "off" },
    meta: { select: "id,name,role" },
  });

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<StaffFormValues>({
    defaultValues: {
      role:     "Sales",
      status:   "Active",
      hire_date: new Date().toISOString().split("T")[0],
    },
  });

  const watchedRole = watch("role");
  const isAdmin     = identity?.role === "Admin";
  const isBusy      = isCreating || credStatus.state === "sending";

  // ── Submit handler ──────────────────────────────────────────────────────────
  const onSubmit = (values: StaffFormValues) => {
    const commissionDecimal = values.commission_rate_override
      ? parseFloat(values.commission_rate_override) / 100
      : null;

    createStaff(
      {
        resource: "staff",
        values: {
          name:                     values.name.trim(),
          email:                    values.email.trim().toLowerCase(),
          phone:                    values.phone?.trim() || null,
          role:                     values.role,
          department:               values.department || null,
          job_title:                values.job_title?.trim() || null,
          status:                   values.status,
          leader_id:                values.leader_id || null,
          hire_date:                values.hire_date || null,
          base_salary:              values.base_salary ? parseFloat(values.base_salary) : null,
          commission_rate_override: isAdmin ? commissionDecimal : null,
        },
      },
      {
        onSuccess: async (result) => {
          // Refine v4 + Supabase: created record is at result.data
          const staffId   = (result.data as Staff).id;
          const staffName = values.name.trim();
          const staffEmail = values.email.trim().toLowerCase();

          // Guard: must have a staff ID to provision auth
          if (!staffId) {
            list("staff");
            return;
          }

          setCredStatus({ state: "sending" });

          try {
            const { data: efData, error: efErr } = await supabaseClient.functions.invoke(
              "create-staff-user",
              {
                body: {
                  staff_id: staffId,
                  email:    staffEmail,
                  name:     staffName,
                },
              }
            );

            if (efErr) {
              setCredStatus({
                state:   "error",
                message: efErr.message ?? "Edge Function invocation failed.",
              });
              return; // Stay on page so admin sees the error
            }

            const payload = efData as {
              auth_user_id:  string;
              email_sent:    boolean;
              email_warning?: string;
            };

            setCredStatus({
              state:     "success",
              emailSent: payload.email_sent,
              warning:   payload.email_warning,
            });

            // Navigate after a short pause so the banner is visible
            setTimeout(() => list("staff"), 2200);

          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setCredStatus({ state: "error", message: msg });
          }
        },
        onError: (err) => {
          // Staff INSERT failed — surface the real reason to the admin
          const raw = (err as { message?: string; statusCode?: number } | null);
          const msg = raw?.message ?? String(err);
          const isDuplicate =
            raw?.statusCode === 409 ||
            msg.toLowerCase().includes("duplicate") ||
            msg.toLowerCase().includes("unique") ||
            msg.toLowerCase().includes("already exists");
          setCredStatus({
            state:   "error",
            message: isDuplicate
              ? `Email already exists in the staff table. Please use a different email address, or check if this staff member was previously offboarded.`
              : `Failed to save staff record: ${msg}`,
          });
        },
      }
    );
  };

  // ── Field classes ─────────────────────────────────────────────────────────
  const inputCls = (hasError: boolean) =>
    `w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2
     focus:ring-blue-500 bg-white
     ${hasError ? "border-red-400 focus:ring-red-400" : "border-gray-300"}`;

  const labelCls = "block text-xs font-semibold text-gray-600 mb-1";
  const errCls   = "text-xs text-red-500 mt-1";

  return (
    <div className="max-w-2xl space-y-4">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => list("staff")}
          className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          ← Staff
        </button>
        <span className="text-gray-300">/</span>
        <h1 className="text-xl font-bold text-gray-900">New Staff Member</h1>
      </div>

      {/* ── Credential status banner ─────────────────────────────────────── */}
      {credStatus.state === "sending" && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200
                        rounded-lg px-4 py-3 text-sm text-blue-700">
          <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10"
                    stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <span>Creating login account and sending credentials…</span>
        </div>
      )}

      {credStatus.state === "success" && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 bg-green-50 border border-green-200
                          rounded-lg px-4 py-3 text-sm text-green-800">
            <span className="shrink-0 text-base">✅</span>
            <div>
              <p className="font-semibold">Staff account created successfully.</p>
              {credStatus.emailSent ? (
                <p className="text-xs mt-0.5 text-green-700">
                  Login credentials have been emailed to the new staff member.
                </p>
              ) : (
                <p className="text-xs mt-0.5 text-amber-700">
                  Account created but email was not sent — admin must share credentials manually.
                </p>
              )}
              <p className="text-xs mt-0.5 text-green-600">Redirecting to staff list…</p>
            </div>
          </div>
          {credStatus.warning && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200
                            rounded-lg px-4 py-3 text-xs text-amber-800">
              <span className="shrink-0">⚠️</span>
              <span>{credStatus.warning}</span>
            </div>
          )}
        </div>
      )}

      {credStatus.state === "error" && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200
                        rounded-lg px-4 py-3 text-sm text-red-800">
          <span className="shrink-0 text-base">❌</span>
          <div>
            <p className="font-semibold">Failed to create login credentials.</p>
            <p className="text-xs mt-0.5 text-red-700">{credStatus.message}</p>
            <p className="text-xs mt-1 text-red-600">
              The staff record was saved. You can retry by editing the staff member
              and using the "Create Login" action, or create the auth account manually
              in the Supabase dashboard.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

        {/* ── Personal Information ─────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide border-b border-gray-100 pb-2">
            Personal Information
          </h2>

          {/* Name */}
          <div>
            <label className={labelCls}>Full Name <span className="text-red-500">*</span></label>
            <input
              {...register("name", { required: "Name is required" })}
              type="text"
              placeholder="e.g. Ahmad Fariz"
              className={inputCls(!!errors.name)}
              disabled={isBusy}
            />
            {errors.name && <p className={errCls}>{errors.name.message}</p>}
          </div>

          {/* Email */}
          <div>
            <label className={labelCls}>
              Email <span className="text-red-500">*</span>
              <span className="ml-1 font-normal text-gray-400">
                — used as login username
              </span>
            </label>
            <input
              {...register("email", {
                required: "Email is required",
                pattern:  { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Invalid email" },
              })}
              type="email"
              placeholder="e.g. ahmad@mediglove.com"
              className={inputCls(!!errors.email)}
              disabled={isBusy}
            />
            {errors.email && <p className={errCls}>{errors.email.message}</p>}
          </div>

          {/* Phone */}
          <div>
            <label className={labelCls}>Phone</label>
            <input
              {...register("phone")}
              type="tel"
              placeholder="e.g. +60 12-345 6789"
              className={inputCls(false)}
              disabled={isBusy}
            />
          </div>

          {/* Hire Date */}
          <div>
            <label className={labelCls}>Hire Date</label>
            <input
              {...register("hire_date")}
              type="date"
              className={inputCls(false)}
              disabled={isBusy}
            />
          </div>
        </div>

        {/* ── Role & Organisation ──────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide border-b border-gray-100 pb-2">
            Role &amp; Organisation
          </h2>

          {/* Role */}
          <div>
            <label className={labelCls}>Role <span className="text-red-500">*</span></label>
            <select
              {...register("role", { required: true })}
              className={inputCls(false)}
              disabled={isBusy}
            >
              {(Object.keys(ROLE_META) as StaffRole[]).map((r) => (
                <option key={r} value={r}>{ROLE_META[r].label}</option>
              ))}
            </select>
            {watchedRole === "Admin" && (
              <p className="text-xs text-amber-600 mt-1">
                ⚠️ Admin role grants full system access. Confirm with management before saving.
              </p>
            )}
          </div>

          {/* Department */}
          <div>
            <label className={labelCls}>
              Department <span className="text-red-500">*</span>
            </label>
            <select
              {...register("department", { required: "Department is required" })}
              className={inputCls(!!errors.department)}
              disabled={isBusy}
            >
              <option value="">— Select department —</option>
              {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            {errors.department && <p className={errCls}>{errors.department.message}</p>}
          </div>

          {/* Job Title */}
          <div>
            <label className={labelCls}>
              Job Title <span className="text-red-500">*</span>
            </label>
            <input
              {...register("job_title", { required: "Job title is required" })}
              type="text"
              placeholder="e.g. Senior Sales Executive"
              className={inputCls(!!errors.job_title)}
              disabled={isBusy}
            />
            {errors.job_title && <p className={errCls}>{errors.job_title.message}</p>}
          </div>

          {/* Leader (only relevant for Sales / Leader roles) */}
          {(watchedRole === "Sales" || watchedRole === "Leader") && (
            <div>
              <label className={labelCls}>Reports To (Leader)</label>
              <select
                {...register("leader_id")}
                className={inputCls(false)}
                disabled={isBusy}
              >
                <option value="">— No leader assigned —</option>
                {(leaderOptions?.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.role})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Status */}
          <div>
            <label className={labelCls}>Status</label>
            <select
              {...register("status")}
              className={inputCls(false)}
              disabled={isBusy}
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>

        {/* ── Compensation (Admin only) ────────────────────────────────── */}
        {isAdmin && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide border-b border-gray-100 pb-2">
              Compensation{" "}
              <span className="text-xs text-gray-400 font-normal normal-case">
                (Admin only — hidden from other roles)
              </span>
            </h2>

            {/* Base Salary */}
            <div>
              <label className={labelCls}>Base Salary (RM)</label>
              <input
                {...register("base_salary")}
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 3500.00"
                className={inputCls(false)}
                disabled={isBusy}
              />
            </div>

            {/* Commission Override */}
            <div>
              <label className={labelCls}>
                Commission Rate Override (%)
                <span className="ml-1 text-gray-400 font-normal">
                  — leave blank to use system default
                </span>
              </label>
              <div className="relative">
                <input
                  {...register("commission_rate_override", {
                    min: { value: 0,   message: "Cannot be negative" },
                    max: { value: 100, message: "Cannot exceed 100%" },
                  })}
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="e.g. 3.50"
                  className={`${inputCls(!!errors.commission_rate_override)} pr-8`}
                  disabled={isBusy}
                />
                <span className="absolute right-3 top-2 text-sm text-gray-400">%</span>
              </div>
              {errors.commission_rate_override && (
                <p className={errCls}>{errors.commission_rate_override.message}</p>
              )}
            </div>
          </div>
        )}

        {/* Credential info note */}
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200
                        rounded-lg px-4 py-3 text-xs text-blue-700">
          <span className="shrink-0">ℹ️</span>
          <span>
            A login account will be created automatically using the email above.
            A temporary password will be generated and emailed to the new staff member.
          </span>
        </div>

        {/* ── Actions ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 justify-end pt-2">
          <button
            type="button"
            onClick={() => list("staff")}
            disabled={isBusy}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg
                       hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isBusy}
            className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg
                       hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors"
          >
            {isCreating
              ? "Saving…"
              : credStatus.state === "sending"
              ? "Setting up login…"
              : "Create Staff & Send Credentials"}
          </button>
        </div>
      </form>
    </div>
  );
}
