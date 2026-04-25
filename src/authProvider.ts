import type { AuthProvider } from "@refinedev/core";
import { supabaseClient } from "./supabaseClient";

// ─────────────────────────────────────────────────────────────────────────────
// MediGlove Auth Provider
// Delegates authentication entirely to Supabase Auth.
// After login, we also fetch the staff row to enrich the identity object
// with role, department and job_title for downstream RLS.
// ─────────────────────────────────────────────────────────────────────────────
export const authProvider: AuthProvider = {
  // ── Login ────────────────────────────────────────────────────────────────
  login: async ({ email, password }) => {
    const { error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return {
        success: false,
        error: {
          name: "LoginError",
          message: error.message,
        },
      };
    }

    return {
      success: true,
      redirectTo: "/",
    };
  },

  // ── Logout ───────────────────────────────────────────────────────────────
  logout: async () => {
    const { error } = await supabaseClient.auth.signOut();

    if (error) {
      return {
        success: false,
        error: {
          name: "LogoutError",
          message: error.message,
        },
      };
    }

    return {
      success: true,
      redirectTo: "/login",
    };
  },

  // ── Check session ─────────────────────────────────────────────────────────
  check: async () => {
    const { data } = await supabaseClient.auth.getSession();

    if (data.session) {
      return { authenticated: true };
    }

    return {
      authenticated: false,
      redirectTo: "/login",
      error: {
        name: "Unauthenticated",
        message: "Your session has expired. Please log in again.",
      },
    };
  },

  // ── Error handler (maps 401/403 to logout) ───────────────────────────────
  onError: async (error) => {
    if (error?.status === 401 || error?.status === 403) {
      await supabaseClient.auth.signOut();
      return {
        logout: true,
        redirectTo: "/login",
        error,
      };
    }

    return { error };
  },

  // ── Get identity (enriched with staff.role) ───────────────────────────────
  getIdentity: async () => {
    const { data: { user } } = await supabaseClient.auth.getUser();

    if (!user) return null;

    // Fetch the staff row that bridges auth.users ↔ staff table
    const { data: staffRow } = await supabaseClient
      .from("staff")
      .select("id, name, email, role, department, job_title, status")
      .eq("auth_user_id", user.id)
      .single();

    if (!staffRow) return null;

    // Block inactive accounts immediately
    if (staffRow.status === "Inactive") {
      await supabaseClient.auth.signOut();
      return null;
    }

    return {
      id:          staffRow.id,
      name:        staffRow.name,
      email:       staffRow.email,
      role:        staffRow.role,
      department:  staffRow.department,
      job_title:   staffRow.job_title,
      avatar:      `https://ui-avatars.com/api/?name=${encodeURIComponent(staffRow.name)}&background=2563eb&color=fff`,
    };
  },

  // ── Permission check (role-based) ─────────────────────────────────────────
  getPermissions: async () => {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return null;

    const { data: staffRow } = await supabaseClient
      .from("staff")
      .select("role")
      .eq("auth_user_id", user.id)
      .single();

    return staffRow?.role ?? null;
  },
};
