// ══════════════════════════════════════════════════════════════════════════════
// src/types/staff.ts — MediGlove ERP · Staff domain types
// EPIC-02 / T-02.1
// Mirrors 001_initial_schema.sql staff table + enum types exactly.
// ══════════════════════════════════════════════════════════════════════════════

export type StaffRole   = "Admin" | "HR" | "Leader" | "Sales" | "Logistics";
export type StaffStatus = "Active" | "Inactive";

export interface Staff {
  id:                        string;          // UUID PK
  auth_user_id:              string | null;   // FK → auth.users.id
  name:                      string;
  email:                     string;
  phone:                     string | null;
  role:                      StaffRole;
  department:                string | null;
  job_title:                 string | null;
  status:                    StaffStatus;
  leader_id:                 string | null;   // FK → staff.id (self-ref)
  hire_date:                 string | null;   // ISO date "YYYY-MM-DD"
  base_salary:               number | null;
  commission_rate_override:  number | null;   // e.g. 0.0350 = 3.50%
  created_at:                string;
  updated_at:                string;

  // Joined fields (populated by select=*,leader:staff(name))
  leader?: { name: string } | null;
}

// ── Form value shape (subset of Staff, used in create/edit) ──────────────────
export interface StaffFormValues {
  name:                     string;
  email:                    string;
  phone:                    string;
  role:                     StaffRole;
  department:               string;
  job_title:                string;
  status:                   StaffStatus;
  leader_id:                string;
  hire_date:                string;
  base_salary:              string;          // kept as string for <input type="number">
  commission_rate_override: string;          // e.g. "3.50" (percent), stored as 0.035
}

// ── Role meta for UI badges ───────────────────────────────────────────────────
export const ROLE_META: Record<StaffRole, { label: string; color: string }> = {
  Admin:     { label: "Admin",     color: "bg-purple-100 text-purple-800" },
  HR:        { label: "HR",        color: "bg-blue-100 text-blue-800"     },
  Leader:    { label: "Leader",    color: "bg-amber-100 text-amber-800"   },
  Sales:     { label: "Sales",     color: "bg-green-100 text-green-800"   },
  Logistics: { label: "Logistics", color: "bg-cyan-100 text-cyan-800"     },
};

// ── Status meta ───────────────────────────────────────────────────────────────
export const STATUS_META: Record<StaffStatus, { label: string; color: string }> = {
  Active:   { label: "Active",   color: "bg-emerald-100 text-emerald-800" },
  Inactive: { label: "Inactive", color: "bg-gray-100 text-gray-500"       },
};

// ── Role hierarchy (used for permission gates) ────────────────────────────────
// A role index >= requiredIndex means the user has sufficient privilege.
export const ROLE_RANK: Record<StaffRole, number> = {
  Logistics: 0,
  Sales:     1,
  Leader:    2,
  HR:        3,
  Admin:     4,
};

export function hasMinRole(userRole: StaffRole, required: StaffRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[required];
}
