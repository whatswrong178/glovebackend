/**
 * tools/commission.ts
 * MCP tools for commission reporting and dashboard KPIs.
 *
 * Registered tools:
 *   erp_get_dashboard_kpis      — mirrors the get_dashboard_kpis() RPC
 *   erp_calculate_commission    — detailed commission breakdown for a staff member
 *   erp_list_staff              — list all staff with roles (for context)
 *
 * 见款发佣则: commission figures are always derived from Paid invoices only.
 * Pending/Overdue invoices contribute to est_commission display only.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z }         from "zod";
import { supabase }  from "../supabase.js";

function ok(data: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(msg: string): { content: { type: "text"; text: string }[]; isError: true } {
  return { content: [{ type: "text", text: `ERROR: ${msg}` }], isError: true };
}

export function registerCommissionTools(server: McpServer) {

  // ── erp_get_dashboard_kpis ──────────────────────────────────────────────────
  server.tool(
    "erp_get_dashboard_kpis",
    "Fetch system-wide dashboard KPIs: active invoices count, estimated commission (from Pending invoices), actual commission (from Paid invoices this month), and orphan public pool client count.",
    {
      staff_id: z.string().uuid().optional().describe("Scope KPIs to a specific staff member. If omitted, returns company-wide totals (Admin/HR use)."),
    },
    async ({ staff_id }) => {
      if (staff_id) {
        // Per-staff KPIs computed directly
        const now = new Date();
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

        const [pendingRes, paidRes, publicRes] = await Promise.all([
          // Active (pending/overdue) invoices — no commission_amount column, use total_amount
          supabase
            .from("invoices")
            .select("id, total_amount")
            .eq("created_by", staff_id)
            .in("status", ["Pending", "Overdue"]),

          // Paid this month (paid_at is the correct column name)
          supabase
            .from("invoices")
            .select("id, total_amount")
            .eq("created_by", staff_id)
            .eq("status", "Paid")
            .gte("paid_at", monthStart),

          // Public pool (orphan clients — is_orphan is the correct column name)
          supabase
            .from("clients")
            .select("id", { count: "exact", head: true })
            .eq("owner_id", staff_id)
            .eq("is_orphan", true),
        ]);

        const active_invoices   = pendingRes.data?.length ?? 0;
        // Commission amounts live in the commissions table (calculated at month-end).
        // Here we show pending/paid revenue as a proxy for KPI display.
        const est_commission    = (pendingRes.data ?? []).reduce((s, r) => s + (r.total_amount ?? 0), 0);
        const actual_commission = (paidRes.data   ?? []).reduce((s, r) => s + (r.total_amount ?? 0), 0);
        const public_pool       = publicRes.count ?? 0;

        return ok({
          scope: "staff",
          staff_id,
          active_invoices,
          est_commission:    Math.round(est_commission    * 100) / 100,
          actual_commission: Math.round(actual_commission * 100) / 100,
          public_pool,
        });
      }

      // Company-wide: delegate to the Supabase RPC (same logic as frontend)
      const { data, error } = await supabase.rpc("get_dashboard_kpis");
      if (error) return err(error.message);
      return ok({ scope: "company", ...data });
    }
  );

  // ── erp_calculate_commission ────────────────────────────────────────────────
  server.tool(
    "erp_calculate_commission",
    "Compute a detailed commission breakdown for a staff member over a date range. Returns per-invoice rows split by Paid (actual) vs Pending/Overdue (estimated). Enforces 见款发佣则: only Paid invoices count toward payable commission.",
    {
      staff_id:  z.string().uuid().describe("Staff UUID"),
      date_from: z.string().date().describe("Start of period (YYYY-MM-DD, inclusive)"),
      date_to:   z.string().date().describe("End of period (YYYY-MM-DD, inclusive)"),
    },
    async ({ staff_id, date_from, date_to }) => {
      const { data: staff } = await supabase
        .from("staff")
        .select("id, name, role")
        .eq("id", staff_id)
        .maybeSingle();

      // Correct columns: paid_at (not paid_date), total_amount (no commission_amount column)
      const { data: invoices, error } = await supabase
        .from("invoices")
        .select(`
          id, invoice_no, status, paid_at,
          total_amount, discount, delivery_charge,
          client:clients ( id, name )
        `)
        .eq("created_by", staff_id)
        .gte("created_at", date_from)
        .lte("created_at", date_to)
        .order("created_at", { ascending: false });

      if (error) return err(error.message);

      const rows = invoices ?? [];
      const paid    = rows.filter(r => r.status === "Paid");
      const pending = rows.filter(r => r.status !== "Paid" && r.status !== "Cancelled");

      // Commission is calculated by the DB engine (fn_calculate_monthly_payout).
      // Here we provide total_amount as the revenue basis for context.
      const sumRevenue = (arr: typeof rows) =>
        arr.reduce((s, r) => s + (r.total_amount ?? 0), 0);

      return ok({
        staff,
        period: { from: date_from, to: date_to },
        summary: {
          paid_revenue:          Math.round(sumRevenue(paid)    * 100) / 100,
          pending_revenue:       Math.round(sumRevenue(pending) * 100) / 100,
          paid_invoice_count:    paid.length,
          pending_invoice_count: pending.length,
          note: "Actual commission amounts are computed by fn_calculate_monthly_payout() at month-end. Query the commissions table for finalised figures.",
        },
        rule: "见款发佣则: only Paid invoices count toward payable commission.",
        invoices: rows,
      });
    }
  );

  // ── erp_list_staff ──────────────────────────────────────────────────────────
  server.tool(
    "erp_list_staff",
    "List all staff members with their roles. Useful for resolving names to UUIDs before calling other tools.",
    {
      role: z.enum(["Admin", "HR", "Leader", "Sales"]).optional().describe("Filter by role"),
    },
    async ({ role }) => {
      let q = supabase
        .from("staff")
        .select("id, name, role, created_at")
        .order("name");

      if (role) q = q.eq("role", role);

      const { data, error } = await q;
      if (error) return err(error.message);
      return ok({ staff: data });
    }
  );
}
