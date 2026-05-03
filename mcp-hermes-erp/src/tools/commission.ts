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
          // Active (pending/overdue) invoices
          supabase
            .from("invoices")
            .select("id, commission_amount")
            .eq("created_by", staff_id)
            .in("status", ["Pending", "Overdue"]),

          // Paid this month
          supabase
            .from("invoices")
            .select("id, commission_amount")
            .eq("created_by", staff_id)
            .eq("status", "Paid")
            .gte("paid_date", monthStart),

          // Public pool (owner = this staff, no activity — simplified)
          supabase
            .from("clients")
            .select("id", { count: "exact", head: true })
            .eq("owner_id", staff_id)
            .eq("is_public", true),
        ]);

        const active_invoices   = pendingRes.data?.length ?? 0;
        const est_commission    = (pendingRes.data ?? []).reduce((s, r) => s + (r.commission_amount ?? 0), 0);
        const actual_commission = (paidRes.data   ?? []).reduce((s, r) => s + (r.commission_amount ?? 0), 0);
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

      const { data: invoices, error } = await supabase
        .from("invoices")
        .select(`
          id, invoice_no, status, invoice_date, paid_date,
          total_amount, commission_rate, commission_amount,
          client:clients ( id, name )
        `)
        .eq("created_by", staff_id)
        .gte("invoice_date", date_from)
        .lte("invoice_date", date_to)
        .order("invoice_date", { ascending: false });

      if (error) return err(error.message);

      const rows = invoices ?? [];
      const paid    = rows.filter(r => r.status === "Paid");
      const pending = rows.filter(r => r.status !== "Paid" && r.status !== "Cancelled");

      const sum = (arr: typeof rows) =>
        arr.reduce((s, r) => s + (r.commission_amount ?? 0), 0);

      return ok({
        staff,
        period: { from: date_from, to: date_to },
        summary: {
          actual_commission_payable: Math.round(sum(paid)    * 100) / 100,
          estimated_commission:      Math.round(sum(pending) * 100) / 100,
          paid_invoice_count:        paid.length,
          pending_invoice_count:     pending.length,
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
