// ══════════════════════════════════════════════════════════════════════════════
// src/pages/hr/list.tsx — Staff Management List
// MediGlove ERP · EPIC-02 / T-02.1
//
// Features:
//   • Paginated table with search (name/email/dept) + role/status filters
//   • Role & Status badges from types/staff.ts meta
//   • Clicking a row navigates to Staff Show page
//   • Admin-only: Edit, Offboard actions
//   • Offboard triggers DB-level fn_staff_offboarding() via status PATCH
//   • HR role: Create button visible
//   • Zero external UI libraries — pure Tailwind dense-table pattern
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useCallback } from "react";
import { useList, useUpdate, useGetIdentity, useNavigation } from "@refinedev/core";
import type { CrudFilters } from "@refinedev/core";
import type { Staff, StaffRole, StaffStatus } from "../../types/staff";
import { ROLE_META, STATUS_META } from "../../types/staff";

const PAGE_SIZE = 20;

// ─── Local initials avatar — CSP-safe, no external requests ──────────────────
function generateInitialsAvatar(name: string): string {
  const initials = name
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">`,
    `<circle cx="16" cy="16" r="16" fill="#2563eb"/>`,
    `<text x="16" y="21" font-family="Arial,Helvetica,sans-serif" `,
    `font-size="13" font-weight="700" fill="#ffffff" text-anchor="middle">`,
    initials,
    `</text>`,
    `</svg>`,
  ].join("");

  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

const ROLE_OPTIONS: Array<{ value: StaffRole | ""; label: string }> = [
  { value: "",          label: "All Roles"   },
  { value: "Admin",     label: "Admin"       },
  { value: "HR",        label: "HR"          },
  { value: "Leader",    label: "Leader"      },
  { value: "Sales",     label: "Sales"       },
  { value: "Logistics", label: "Logistics"   },
];

const STATUS_OPTIONS: Array<{ value: StaffStatus | ""; label: string }> = [
  { value: "",         label: "All Status" },
  { value: "Active",   label: "Active"     },
  { value: "Inactive", label: "Inactive"   },
];

export function HRListPage() {
  const { data: identity } = useGetIdentity<{ id: string; name: string; role: StaffRole }>();
  const { edit, create, show } = useNavigation();
  const { mutate: updateStaff, isLoading: isOffboarding } = useUpdate();

  const [search,        setSearch]        = useState("");
  const [roleFilter,    setRoleFilter]    = useState<StaffRole | "">("");
  const [statusFilter,  setStatusFilter]  = useState<StaffStatus | "">("Active");
  const [currentPage,   setCurrentPage]   = useState(1);
  const [offboardingId, setOffboardingId] = useState<string | null>(null);

  const filters: CrudFilters = [];
  if (roleFilter)   filters.push({ field: "role",   operator: "eq", value: roleFilter });
  if (statusFilter) filters.push({ field: "status", operator: "eq", value: statusFilter });

  const { data, isLoading, isError } = useList<Staff>({
    resource: "staff",
    pagination: { current: currentPage, pageSize: PAGE_SIZE },
    filters,
    sorters: [{ field: "name", order: "asc" }],
    meta: {
      select: "id,name,email,phone,role,department,job_title,status,hire_date,leader_id,leader:staff!leader_id(name),created_at",
    },
  });

  const rows = (data?.data ?? []).filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.email.toLowerCase().includes(q) ||
      (s.department ?? "").toLowerCase().includes(q)
    );
  });

  const totalCount = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const handleOffboard = useCallback(
    (staff: Staff) => {
      if (
        !window.confirm(
          `⚠️ Offboard "${staff.name}"?\n\nThis will:\n• Set status → Inactive\n• Release all owned clients to public pool\n• Unlink their direct reports' leader\n\nThis action cannot be undone.`
        )
      )
        return;

      setOffboardingId(staff.id);
      updateStaff(
        { resource: "staff", id: staff.id, values: { status: "Inactive" } },
        {
          onSuccess: () => setOffboardingId(null),
          onError:   () => setOffboardingId(null),
        }
      );
    },
    [updateStaff]
  );

  const isAdmin = identity?.role === "Admin";
  const isHR    = identity?.role === "HR" || isAdmin;

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Staff Management</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {totalCount} records · Page {currentPage}/{totalPages}
          </p>
        </div>
        {isHR && (
          <button
            onClick={() => create("staff")}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700
                       text-white text-sm font-medium rounded-lg transition-colors"
          >
            <span className="text-base leading-none">＋</span>
            New Staff
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          placeholder="Search name, email, department…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
          className="flex-1 min-w-[200px] text-sm border border-gray-300 rounded-lg px-3 py-2
                     focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value as StaffRole | ""); setCurrentPage(1); }}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2
                     focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as StaffStatus | ""); setCurrentPage(1); }}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2
                     focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading staff…</div>
        ) : isError ? (
          <div className="flex items-center justify-center h-48 text-sm text-red-500">
            Failed to load staff.
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-sm text-gray-400 gap-2">
            <span className="text-3xl">👤</span>
            <span>No staff found</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-8">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Department / Title</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Leader</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Hire Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((staff, idx) => {
                  const roleMeta          = ROLE_META[staff.role];
                  const statusMeta        = STATUS_META[staff.status];
                  const isThisOffboarding = isOffboarding && offboardingId === staff.id;
                  const leaderName        = (staff as unknown as { leader?: { name: string } }).leader?.name;

                  return (
                    <tr
                      key={staff.id}
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => show("staff", staff.id)}
                    >
                      <td className="px-4 py-3 text-gray-400 tabular-nums">
                        {(currentPage - 1) * PAGE_SIZE + idx + 1}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <img
                            src={generateInitialsAvatar(staff.name)}
                            alt=""
                            className="w-8 h-8 rounded-full flex-shrink-0"
                          />
                          <div>
                            <p className="font-medium text-gray-900 leading-tight hover:text-blue-600 transition-colors">
                              {staff.name}
                            </p>
                            <p className="text-xs text-gray-400">{staff.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${roleMeta.color}`}>
                          {roleMeta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-gray-700">{staff.department ?? "—"}</p>
                        <p className="text-xs text-gray-400">{staff.job_title ?? "—"}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {leaderName ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600 tabular-nums">
                        {staff.hire_date
                          ? new Date(staff.hire_date).toLocaleDateString("en-MY", {
                              day: "2-digit", month: "short", year: "numeric",
                            })
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusMeta.color}`}>
                          {statusMeta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div
                          className="flex items-center justify-end gap-2"
                          onClick={(e) => e.stopPropagation()} // prevent row click when clicking action buttons
                        >
                          {isAdmin && (
                            <button
                              onClick={() => edit("staff", staff.id)}
                              className="text-xs px-2.5 py-1 rounded border border-gray-200
                                         text-gray-600 hover:bg-gray-100 transition-colors"
                            >
                              Edit
                            </button>
                          )}
                          {isAdmin && staff.status === "Active" && (
                            <button
                              onClick={() => handleOffboard(staff)}
                              disabled={isThisOffboarding}
                              className="text-xs px-2.5 py-1 rounded border border-red-200
                                         text-red-600 hover:bg-red-50 transition-colors
                                         disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isThisOffboarding ? "…" : "Offboard"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, totalCount)} of {totalCount}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50
                         disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ← Prev
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50
                         disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
