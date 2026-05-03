/**
 * tools/invoices.ts
 * MCP tools for the `invoices` table.
 *
 * Registered tools:
 *   erp_list_invoices       — paginated list with status / client / date filters
 *   erp_get_invoice         — single invoice + line items
 *   erp_create_invoice      — create invoice with line items (destructive)
 *   erp_mark_invoice_paid   — set status=Paid + record receipt date (destructive)
 *
 * 见款发佣则 (Paid-then-commission): erp_mark_invoice_paid is the ONLY
 * path that triggers commission eligibility. The tool enforces this by
 * only transitioning Pending/Overdue → Paid.
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

// ── Shared Zod sub-schemas ─────────────────────────────────────────────────────

const InvoiceStatus = z.enum(["Pending", "Paid", "Overdue", "Cancelled"]);

const LineItemSchema = z.object({
  product_id: z.string().uuid().describe("Product UUID"),
  qty:        z.number().int().positive().describe("Quantity"),
  unit_price: z.number().positive().describe("Override price (leave undefined to use product catalogue price)").optional(),
  discount:   z.number().min(0).max(100).default(0).describe("Discount percentage 0–100"),
});

// ── Tool registration ──────────────────────────────────────────────────────────

export function registerInvoiceTools(server: McpServer) {

  // ── erp_list_invoices ───────────────────────────────────────────────────────
  server.tool(
    "erp_list_invoices",
    "List invoices with optional filters by status, client, sales rep, and date range. Returns invoice totals, commission rates, and payment dates.",
    {
      status:     InvoiceStatus.optional().describe("Filter by invoice status"),
      client_id:  z.string().uuid().optional().describe("Filter by client UUID"),
      created_by: z.string().uuid().optional().describe("Filter by sales rep staff UUID"),
      date_from:  z.string().date().optional().describe("Invoice date from (ISO 8601, inclusive)"),
      date_to:    z.string().date().optional().describe("Invoice date to (ISO 8601, inclusive)"),
      limit:      z.number().int().min(1).max(200).default(50),
      offset:     z.number().int().min(0).default(0),
    },
    async ({ status, client_id, created_by, date_from, date_to, limit, offset }) => {
      let q = supabase
        .from("invoices")
        .select(`
          id, invoice_no, status, total_amount, commission_rate, commission_amount,
          invoice_date, due_date, paid_date, notes, created_at,
          client:clients ( id, name, region ),
          rep:staff!created_by ( id, name, role )
        `, { count: "exact" })
        .order("invoice_date", { ascending: false })
        .range(offset, offset + limit - 1);

      if (status)     q = q.eq("status", status);
      if (client_id)  q = q.eq("client_id", client_id);
      if (created_by) q = q.eq("created_by", created_by);
      if (date_from)  q = q.gte("invoice_date", date_from);
      if (date_to)    q = q.lte("invoice_date", date_to);

      const { data, error, count } = await q;
      if (error) return err(error.message);
      return ok({ total: count, offset, limit, invoices: data });
    }
  );

  // ── erp_get_invoice ─────────────────────────────────────────────────────────
  server.tool(
    "erp_get_invoice",
    "Fetch a single invoice by UUID, including all line items and their products.",
    {
      id: z.string().uuid().describe("Invoice UUID"),
    },
    async ({ id }) => {
      const { data: invoice, error: iErr } = await supabase
        .from("invoices")
        .select(`
          id, invoice_no, status, total_amount, commission_rate, commission_amount,
          invoice_date, due_date, paid_date, notes, created_at,
          client:clients ( id, name, region, contact_person, contact_phone ),
          rep:staff!created_by ( id, name, role )
        `)
        .eq("id", id)
        .maybeSingle();

      if (iErr)    return err(iErr.message);
      if (!invoice) return err(`No invoice found with id=${id}`);

      const { data: lines, error: lErr } = await supabase
        .from("invoice_items")
        .select(`
          id, qty, unit_price, discount, line_total,
          product:products ( id, name, sku, category, unit )
        `)
        .eq("invoice_id", id)
        .order("id");

      if (lErr) return err(lErr.message);
      return ok({ ...invoice, line_items: lines ?? [] });
    }
  );

  // ── erp_create_invoice ──────────────────────────────────────────────────────
  server.tool(
    "erp_create_invoice",
    "Create a new invoice with line items. Totals and commission amounts are computed server-side. Returns the created invoice id and invoice_no.",
    {
      client_id:       z.string().uuid().describe("Client UUID"),
      created_by:      z.string().uuid().describe("Staff UUID of the sales rep"),
      invoice_date:    z.string().date().describe("Invoice date (YYYY-MM-DD)"),
      due_date:        z.string().date().describe("Payment due date (YYYY-MM-DD)"),
      commission_rate: z.number().min(0).max(100).default(5).describe("Commission rate % for this invoice"),
      notes:           z.string().optional().describe("Internal notes"),
      line_items:      z.array(LineItemSchema).min(1).describe("At least one line item required"),
    },
    async ({ client_id, created_by, invoice_date, due_date, commission_rate, notes, line_items }) => {
      // Resolve unit prices for any items where not overridden
      const productIds = line_items.map(l => l.product_id);
      const { data: products, error: pErr } = await supabase
        .from("products")
        .select("id, unit_price")
        .in("id", productIds);

      if (pErr) return err(`Product lookup failed: ${pErr.message}`);

      const priceMap = Object.fromEntries((products ?? []).map(p => [p.id, p.unit_price as number]));

      // Compute totals
      let totalAmount = 0;
      const resolvedLines = line_items.map(item => {
        const basePrice = item.unit_price ?? priceMap[item.product_id];
        if (!basePrice) return null;
        const discountedPrice = basePrice * (1 - (item.discount ?? 0) / 100);
        const lineTotal = discountedPrice * item.qty;
        totalAmount += lineTotal;
        return {
          product_id: item.product_id,
          qty:        item.qty,
          unit_price: basePrice,
          discount:   item.discount ?? 0,
          line_total: Math.round(lineTotal * 100) / 100,
        };
      });

      if (resolvedLines.some(l => l === null)) {
        return err("One or more product_ids not found in catalogue.");
      }

      totalAmount = Math.round(totalAmount * 100) / 100;
      const commissionAmount = Math.round(totalAmount * (commission_rate / 100) * 100) / 100;

      // Insert invoice
      const { data: invoice, error: iErr } = await supabase
        .from("invoices")
        .insert({
          client_id,
          created_by,
          invoice_date,
          due_date,
          commission_rate,
          commission_amount: commissionAmount,
          total_amount:      totalAmount,
          status:            "Pending",
          notes: notes ?? null,
        })
        .select("id, invoice_no, total_amount, commission_amount, status")
        .single();

      if (iErr) return err(iErr.message);

      // Insert line items
      const { error: liErr } = await supabase
        .from("invoice_items")
        .insert(resolvedLines.map(l => ({ ...l!, invoice_id: invoice.id })));

      if (liErr) return err(`Invoice created (id=${invoice.id}) but line items failed: ${liErr.message}`);

      return ok({ created: true, invoice });
    }
  );

  // ── erp_mark_invoice_paid ───────────────────────────────────────────────────
  server.tool(
    "erp_mark_invoice_paid",
    [
      "Mark an invoice as Paid and record the receipt date.",
      "⚠️  见款发佣则 (Paid-then-commission): This is the ONLY action that makes commission",
      "eligible for payout. Only transitions Pending or Overdue → Paid.",
      "Cancelled invoices cannot be marked Paid.",
    ].join(" "),
    {
      id:        z.string().uuid().describe("Invoice UUID"),
      paid_date: z.string().date().describe("Date payment was received (YYYY-MM-DD)"),
      notes:     z.string().optional().describe("Payment receipt notes or reference number"),
    },
    async ({ id, paid_date, notes }) => {
      // Guard: fetch current status
      const { data: current, error: fErr } = await supabase
        .from("invoices")
        .select("id, status, invoice_no, total_amount, commission_amount")
        .eq("id", id)
        .maybeSingle();

      if (fErr)    return err(fErr.message);
      if (!current) return err(`No invoice found with id=${id}`);
      if (current.status === "Paid")      return ok({ already_paid: true, invoice: current });
      if (current.status === "Cancelled") return err(`Invoice ${current.invoice_no} is Cancelled and cannot be marked Paid.`);

      const updatePayload: Record<string, unknown> = { status: "Paid", paid_date };
      if (notes) updatePayload.notes = notes;

      const { data: updated, error: uErr } = await supabase
        .from("invoices")
        .update(updatePayload)
        .eq("id", id)
        .select("id, invoice_no, status, paid_date, total_amount, commission_amount")
        .single();

      if (uErr) return err(uErr.message);
      return ok({
        marked_paid: true,
        invoice:     updated,
        message:     `Commission of RM ${updated.commission_amount} is now eligible for payout.`,
      });
    }
  );
}
