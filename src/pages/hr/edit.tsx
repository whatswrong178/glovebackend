// ══════════════════════════════════════════════════════════════════════════════
// src/pages/hr/edit.tsx — Edit Staff (Admin only)
// MediGlove ERP · EPIC-02 / T-02.1
//
// Exposes all staff fields Admin can safely mutate.
// Offboarding via status dropdown triggers trg_staff_offboarding at DB level.
// auth_user_id linkage exposed here so Admin can paste the UUID after the
// Supabase Auth invite is accepted.
// ══════════════════════════════════════════════════════════════════════════════

import React, { useEffect } from "react";
import {
  useOne,
  useUpdate,
  useList,
  useNavigation,
  useGetIdentity,
  useParsed,
} from "@refinedev/core";
import { useForm } from "react-hook-form";
import type { Staff, StaffRole, StaffFormValues } from "../../types/staff";
import { ROLE_META, STATUS_META } from "../../types/staff";

const DEPARTMENTS = [
  "Sales",
  "Finance",
  "Operations",
  "Logistics",
  "Human Resources",
  "Management",
  "IT",
];

export function HREditPage() {
  const { data: identity } = useGetIdentity<{ role: StaffRole }>();
  const { params }         = useParsed();
  const staffId            = params?.id as string;
  const { list }           = useNavigation();

  const { data: staffData, isLoading: isLoadingStaff } = useOne<Staff>({
    resource: "staff",
    id:       staffId,
    meta:     { select: "*,leader:staff!leader_id(name)" },
  });

  const staff = staffData?.data;

  const { data: leaderOptions } = useList<Staff>({
    resource: "staff",
    filters:  [
      { field: "status", operator: "eq", value: "Active"         },
      { field: "role",   operator: "in", value: ["Leader","Admin"] },
      // Exclude self (can't be own leader)
      { field: "id",     operator: "ne", value: staffId           },
    ],
    sorters:    [{ field: "name", order: "asc" }],
    pagination: { mode: "off" },
    meta:       { select: "id,name,role" },
  });

  const { mutate: updateStaff, isLoading: isSaving } = useUpdate<Staff>();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<StaffFormValues & { auth_user_id: string }>();

  // Populate form when data loads
  useEffect(() => {
    if (!staff) return;
    reset({
      name:                     staff.name,
      email:                    staff.email,
      phone:                    staff.phone ?? "",
      role:                     staff.role,
      department:               staff.department ?? "",
      job_title:                staff.job_title ?? "",
      status:                   staff.status,
      leader_id:                staff.leader_id ?? "",
      hire_date:                staff.hire_date ?? "",
      base_salary:              staff.base_salary?.toString() ?? "",
      commission_rate_override: staff.commission_rate_override
        ? (staff.commission_rate_override * 100).toFixed(2)
        : "",
      // @ts-expect-error extended field
      auth_user_id:             staff.auth_user_id ?? "",
    });
  }, [staff, reset]);

  const watchedRole   = watch("role");
  const watchedStatus = watch("status");
  const isAdmin       = identity?.role === "Admin";

  const onSubmit = (values: StaffFormValues & { auth_user_id: string }) => {
    const commissionDecimal = values.commission_rate_override
      ? parseFloat(values.commission_rate_override) / 100
      : null;

    // Warn if Admin is about to offboard via form submit
    if (values.status === "Inactive" && staff?.status === "Active") {
      if (
        !window.confirm(
          `⚠️ You are setting "${staff.name}" to Inactive.\n\nThe offboarding trigger will run automatically:\n• All owned clients → public pool\n• Direct reports lose leader link\n\nContinue?`
        )
      )
        return;
    }

    updateStaff(
      {
        resource: "staff",
        id:       staffId,
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
          commission_rate_override: isAdmin ? commissionDecimal : undefined,
          // @ts-expect-error extended field
          auth_user_id:             values.auth_user_id?.trim() || null,
        },
      },
      { onSuccess: () => list("staff") }
    );
  };

  const inputCls = (hasError: boolean) =>
    `w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2
     focus:ring-blue-500 bg-white
     ${hasError ? "border-red-400" : "border-gray-300"}`;
  const labelCls = "block text-xs font-semibold text-gray-600 mb-1";
  const errCls   = "text-xs text-red-500 mt-1";

  if (isLoadingStaff) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">
        Loading staff record…
      </div>
    );
  }

  if (!staff) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-red-500">
        Staff record not found.
      </div>
    );
  }

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
        <h1 className="text-xl font-bold text-gray-900">Edit: {staff.name}</h1>
        <span className={`ml-auto inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
          ${STATUS_META[staff.status].color}`}>
          {STATUS_META[staff.status].label}
        </span>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

        {/* ── Personal Information ─────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide border-b border-gray-100 pb-2">
            Personal Information
          </h2>

          <div>
            <label className={labelCls}>Full Name <span className="text-red-500">*</span></label>
            <input
              {...register("name", { required: "Name is required" })}
              type="text"
              className={inputCls(!!errors.name)}
            />
            {errors.name && <p className={errCls}>{errors.name.message}</p>}
          </div>

          <div>
            <label className={labelCls}>Email <span className="text-red-500">*</span></label>
            <input
              {...register("email", {
                required: "Email is required",
                pattern:  { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Invalid email" },
              })}
              type="email"
              className={inputCls(!!errors.email)}
            />
            {errors.email && <p className={errCls}>{errors.email.message}</p>}
          </div>

          <div>
            <label className={labelCls}>Phone</label>
            <input {...register("phone")} type="tel" className={inputCls(false)} />
          </div>

          <div>
            <label className={labelCls}>Hire Date</label>
            <input {...register("hire_date")} type="date" className={inputCls(false)} />
          </div>
        </div>

        {/* ── Role & Organisation ──────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide border-b border-gray-100 pb-2">
            Role &amp; Organisation
          </h2>

          <div>
            <label className={labelCls}>Role <span className="text-red-500">*</span></label>
            <select {...register("role")} className={inputCls(false)}>
              {(Object.keys(ROLE_META) as StaffRole[]).map((r) => (
                <option key={r} value={r}>{ROLE_META[r].label}</option>
              ))}
            </select>
            {watchedRole === "Admin" && (
              <p className="text-xs text-amber-600 mt-1">
                ⚠️ Admin role grants full system access.
              </p>
            )}
          </div>

          <div>
            <label className={labelCls}>Department <span className="text-red-500">*</span></label>
            <select
              {...register("department", { required: "Department is required" })}
              className={inputCls(!!errors.department)}
            >
              <option value="">— Select department —</option>
              {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            {errors.department && <p className={errCls}>{errors.department.message}</p>}
          </div>

          <div>
            <label className={labelCls}>Job Title <span className="text-red-500">*</span></label>
            <input
              {...register("job_title", { required: "Job title is required" })}
              type="text"
              className={inputCls(!!errors.job_title)}
            />
            {errors.job_title && <p className={errCls}>{errors.job_title.message}</p>}
          </div>

          {(watchedRole === "Sales" || watchedRole === "Leader") && (
            <div>
              <label className={labelCls}>Reports To (Leader)</label>
              <select {...register("leader_id")} className={inputCls(false)}>
                <option value="">— No leader assigned —</option>
                {(leaderOptions?.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>{l.name} ({l.role})</option>
                ))}
              </select>
            </div>
          )}

          {/* Status — changing to Inactive fires offboarding trigger */}
          <div>
            <label className={labelCls}>Status</label>
            <select {...register("status")} className={inputCls(false)}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
            {watchedStatus === "Inactive" && staff.status === "Active" && (
              <p className="text-xs text-red-600 mt-1">
                ⚠️ Saving as Inactive will trigger automatic client orphan release and leader unlink.
              </p>
            )}
          </div>
        </div>

        {/* ── Auth Linkage (Admin only) ────────────────────────────────── */}
        {isAdmin && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide border-b border-gray-100 pb-2">
              Auth Linkage <span className="text-xs text-gray-400 font-normal normal-case">(Admin only)</span>
            </h2>
            <div>
              <label className={labelCls}>Supabase Auth User ID (UUID)</label>
              <input
                {...register("auth_user_id" as keyof StaffFormValues)}
                type="text"
                placeholder="Paste UUID after staff accepts email invite"
                className={`${inputCls(false)} font-mono text-xs`}
              />
              <p className="text-xs text-gray-400 mt-1">
                Obtain from Supabase Dashboard → Authentication → Users
              </p>
            </div>
          </div>
        )}

        {/* ── Compensation (Admin only) ────────────────────────────────── */}
        {isAdmin && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide border-b border-gray-100 pb-2">
              Compensation <span className="text-xs text-gray-400 font-normal normal-case">(Admin only)</span>
            </h2>

            <div>
              <label className={labelCls}>Base Salary (RM)</label>
              <input
                {...register("base_salary")}
                type="number" min="0" step="0.01"
                className={inputCls(false)}
              />
            </div>

            <div>
              <label className={labelCls}>Commission Rate Override (%)</label>
              <div className="relative">
                <input
                  {...register("commission_rate_override", {
                    min: { value: 0,   message: "Cannot be negative" },
                    max: { value: 100, message: "Cannot exceed 100%" },
                  })}
                  type="number" min="0" max="100" step="0.01"
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
            disabled={isSaving || !isDirty}
            className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg
                       hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors"
          >
            {isSaving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
