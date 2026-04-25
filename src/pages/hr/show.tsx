// ══════════════════════════════════════════════════════════════════════════════
// src/pages/hr/show.tsx — Staff Detail View
// MediGlove ERP · EPIC-02 / T-02.1 + T-02.3
//
// Admin sees: compensation block + Spinoff Approval button (T-02.3)
// Spinoff button calls fn_request_spinoff() RPC — validates 50k GMV,
// locks spinoff_legacy_map, promotes Sales → Leader at DB level.
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState } from "react";
import { useOne, useNavigation, useGetIdentity, useParsed, useCustomMutation } from "@refinedev/core";
import type { Staff, StaffRole } from "../../types/staff";
import { ROLE_META, STATUS_META } from "../../types/staff";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{value ?? <span className="text-gray-300">—</span>}</dd>
    </div>
  );
}

export function HRShowPage() {
  const { data: identity } = useGetIdentity<{ role: StaffRole }>();
  const { params }         = useParsed();
  const staffId            = params?.id as string;
  const { list, edit }     = useNavigation();

  const [spinoffResult, setSpinoffResult] = useState<string | null>(null);

  const { data, isLoading, refetch } = useOne<Staff>({
    resource: "staff",
    id:       staffId,
    meta:     { select: "*,leader:staff!leader_id(name,role)" },
  });

  const { mutate: runSpinoff, isLoading: isSpinoffing } = useCustomMutation();

  const staff   = data?.data;
  const isAdmin = identity?.role === "Admin";

  // ── Spinoff handler ────────────────────────────────────────────────────────
  const handleSpinoff = () => {
    if (!staff) return;
    if (
      !window.confirm(
        `🚀 Approve Spinoff for "${staff.name}"?\n\nThis will:\n• Validate cumulative paid GMV ≥ RM 50,000\n• Lock 0.5% permanent legacy commission for their current Leader\n• Promote ${staff.name}: Sales → Leader\n• Unlink from current team\n\nThis action cannot be undone.`
      )
    )
      return;

    runSpinoff(
      {
        url:    "/rest/v1/rpc/fn_request_spinoff",
        method: "post",
        values: { p_sales_id: staffId },
      },
      {
        onSuccess: (res) => {
          const d = (res as unknown as { data: { success: boolean; message?: string; error?: string } }).data;
          if (d?.success) {
            setSpinoffResult(`✅ ${d.message}`);
            refetch(); // refresh staff data to show updated role
          } else {
            setSpinoffResult(`❌ ${d?.error ?? "Spinoff failed"}`);
          }
        },
        onError: (err) => setSpinoffResult(`❌ RPC error: ${JSON.stringify(err)}`),
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">Loading…</div>
    );
  }

  if (!staff) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-red-500">
        Staff record not found.
      </div>
    );
  }

  const roleMeta   = ROLE_META[staff.role];
  const statusMeta = STATUS_META[staff.status];
  const leaderData = (staff as unknown as { leader?: { name: string; role: StaffRole } }).leader;

  const showSpinoffButton =
    isAdmin &&
    staff.role   === "Sales" &&
    staff.status === "Active";

  return (
    <div className="max-w-2xl space-y-4">

      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => list("staff")}
          className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          ← Staff
        </button>
        <span className="text-gray-300">/</span>
        <h1 className="text-xl font-bold text-gray-900">{staff.name}</h1>
        <div className="ml-auto flex gap-2">
          {isAdmin && (
            <button
              onClick={() => edit("staff", staff.id)}
              className="text-xs px-3 py-1.5 rounded border border-gray-200
                         text-gray-600 hover:bg-gray-100 transition-colors"
            >
              Edit
            </button>
          )}
          {showSpinoffButton && (
            <button
              onClick={handleSpinoff}
              disabled={isSpinoffing}
              className="text-xs px-3 py-1.5 rounded border border-purple-200
                         text-purple-700 bg-purple-50 hover:bg-purple-100
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSpinoffing ? "Processing…" : "🚀 Approve Spinoff"}
            </button>
          )}
        </div>
      </div>

      {/* Spinoff result banner */}
      {spinoffResult && (
        <div className={`rounded-lg px-4 py-3 text-sm
          ${spinoffResult.startsWith("✅")
            ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
            : "bg-red-50 text-red-800 border border-red-200"}`}>
          {spinoffResult}
        </div>
      )}

      {/* Identity card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center gap-4 mb-5">
          <img
            src={`https://ui-avatars.com/api/?name=${encodeURIComponent(staff.name)}&size=56&background=2563eb&color=fff`}
            alt=""
            className="w-14 h-14 rounded-full flex-shrink-0"
          />
          <div>
            <p className="font-bold text-gray-900 text-lg leading-tight">{staff.name}</p>
            <p className="text-sm text-gray-500">{staff.job_title ?? "—"}</p>
            <div className="flex gap-2 mt-1.5">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${roleMeta.color}`}>
                {roleMeta.label}
              </span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusMeta.color}`}>
                {statusMeta.label}
              </span>
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Email"      value={staff.email} />
          <Field label="Phone"      value={staff.phone} />
          <Field label="Department" value={staff.department} />
          <Field label="Hire Date"  value={
            staff.hire_date
              ? new Date(staff.hire_date).toLocaleDateString("en-MY", {
                  day: "2-digit", month: "long", year: "numeric",
                })
              : null
          } />
          <Field label="Reports To" value={
            leaderData ? `${leaderData.name} (${leaderData.role})` : null
          } />
          <Field label="Staff ID" value={
            <span className="font-mono text-xs text-gray-500">{staff.id.slice(0, 8)}…</span>
          } />
          <Field label="Created" value={
            new Date(staff.created_at).toLocaleDateString("en-MY", {
              day: "2-digit", month: "short", year: "numeric",
            })
          } />
          <Field label="Last Updated" value={
            new Date(staff.updated_at).toLocaleDateString("en-MY", {
              day: "2-digit", month: "short", year: "numeric",
            })
          } />
        </dl>
      </div>

      {/* Compensation (Admin only) */}
      {isAdmin && (
        <div className="bg-white rounded-xl shadow-sm border border-amber-100 p-5">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide border-b border-gray-100 pb-2 mb-4">
            Compensation
            <span className="ml-2 text-xs font-normal normal-case text-amber-600">(Admin only)</span>
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
            <Field
              label="Base Salary"
              value={
                staff.base_salary != null
                  ? `RM ${staff.base_salary.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`
                  : null
              }
            />
            <Field
              label="Commission Override"
              value={
                staff.commission_rate_override != null
                  ? `${(staff.commission_rate_override * 100).toFixed(2)}%`
                  : "System default"
              }
            />
            <Field
              label="Mgmt Bonus Active"
              value={
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
                  ${(staff as unknown as { leader_bonus_active: boolean }).leader_bonus_active !== false
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-red-100 text-red-700"}`}>
                  {(staff as unknown as { leader_bonus_active: boolean }).leader_bonus_active !== false
                    ? "Active" : "Stripped"}
                </span>
              }
            />
            <Field
              label="Spinoff Right"
              value={
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
                  ${(staff as unknown as { spinoff_right_active: boolean }).spinoff_right_active !== false
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-red-100 text-red-700"}`}>
                  {(staff as unknown as { spinoff_right_active: boolean }).spinoff_right_active !== false
                    ? "Active" : "Revoked"}
                </span>
              }
            />
          </dl>
        </div>
      )}

      {/* Spinoff eligibility hint for Admin */}
      {showSpinoffButton && (
        <div className="rounded-lg bg-purple-50 border border-purple-100 px-4 py-3 text-xs text-purple-700">
          <strong>Spinoff Eligible:</strong> This Sales member can apply to spin off and build their own team.
          Use "Approve Spinoff" above to validate their RM 50,000 cumulative GMV and execute the promotion.
          Their current Leader will permanently retain 0.5% legacy commission on the new team's GMV.
        </div>
      )}
    </div>
  );
}
