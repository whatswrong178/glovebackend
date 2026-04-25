// ══════════════════════════════════════════════════════════════════════════════
// src/pages/hr/create.tsx — Create Staff (Admin / HR only)
// MediGlove ERP · EPIC-02 / T-02.1
//
// Note on auth_user_id:
//   Creating the Supabase Auth user (email invite) is a separate Admin SDK
//   operation done via Edge Function or Dashboard. This form only creates
//   the staff record; auth_user_id can be linked later via the Edit page
//   once the Auth user accepts their invite.
// ══════════════════════════════════════════════════════════════════════════════

import React from "react";
import { useCreate, useList, useNavigation, useGetIdentity } from "@refinedev/core";
import { useForm } from "react-hook-form";
import type { Staff, StaffRole, StaffFormValues } from "../../types/staff";
import { ROLE_META } from "../../types/staff";

const DEPARTMENTS = [
  "Sales",
  "Finance",
  "Operations",
  "Logistics",
  "Human Resources",
  "Management",
  "IT",
];

export function HRCreatePage() {
  const { data: identity } = useGetIdentity<{ role: StaffRole }>();
  const { list }           = useNavigation();
  const { mutate: createStaff, isLoading } = useCreate<Staff>();

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

  const onSubmit = (values: StaffFormValues) => {
    // Convert commission percent string to decimal (e.g. "3.50" → 0.035)
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
        onSuccess: () => list("staff"),
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
            />
            {errors.name && <p className={errCls}>{errors.name.message}</p>}
          </div>

          {/* Email */}
          <div>
            <label className={labelCls}>Email <span className="text-red-500">*</span></label>
            <input
              {...register("email", {
                required: "Email is required",
                pattern:  { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Invalid email" },
              })}
              type="email"
              placeholder="e.g. ahmad@mediglove.com"
              className={inputCls(!!errors.email)}
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
            />
          </div>

          {/* Hire Date */}
          <div>
            <label className={labelCls}>Hire Date</label>
            <input
              {...register("hire_date")}
              type="date"
              className={inputCls(false)}
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

          {/* Department — MANDATORY per T-02.1 */}
          <div>
            <label className={labelCls}>
              Department <span className="text-red-500">*</span>
            </label>
            <select
              {...register("department", { required: "Department is required" })}
              className={inputCls(!!errors.department)}
            >
              <option value="">— Select department —</option>
              {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            {errors.department && <p className={errCls}>{errors.department.message}</p>}
          </div>

          {/* Job Title — MANDATORY per T-02.1 */}
          <div>
            <label className={labelCls}>
              Job Title <span className="text-red-500">*</span>
            </label>
            <input
              {...register("job_title", { required: "Job title is required" })}
              type="text"
              placeholder="e.g. Senior Sales Executive"
              className={inputCls(!!errors.job_title)}
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
              Compensation <span className="text-xs text-gray-400 font-normal normal-case">(Admin only — hidden from other roles)</span>
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
                    min: { value: 0,   message: "Cannot be negative"    },
                    max: { value: 100, message: "Cannot exceed 100%"    },
                  })}
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="e.g. 3.50"
                  className={`${inputCls(!!errors.commission_rate_override)} pr-8`}
                />
                <span className="absolute right-3 top-2 text-sm text-gray-400">%</span>
              </div>
              {errors.commission_rate_override && (
                <p className={errCls}>{errors.commission_rate_override.message}</p>
              )}
            </div>
          </div>
        )}

        {/* ── Actions ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 justify-end pt-2">
          <button
            type="button"
            onClick={() => list("staff")}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg
                       hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg
                       hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors"
          >
            {isLoading ? "Saving…" : "Create Staff"}
          </button>
        </div>
      </form>
    </div>
  );
}
