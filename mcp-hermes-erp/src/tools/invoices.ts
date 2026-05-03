/**
 * tools/invoices.ts
 * MCP tools for the `invoices` + `invoice_items` tables.
 *
 * Registered tools:
 *   erp_list_invoices       — paginated list with status / client / date filters
 *   erp_get_invoice         — single invoice + line items
 *   erp_create_invoice      — create via create_invoice_atomic() RPC (destructive)
 *   erp_mark_invoice_paid   — set status=Paid + record paid_at (destructive)
 *
 * Actual DB columns (migrations/001 + 007):
 *   invoices:      id, invoice_no, client_id, created_by, status, region,
 *                  delivery_charge, discount, total_amount, paid_at, created_at
 *   invoice_items: id, invoice_id, product_id, qty, selling_price,
 *                  cost_price_snapshot, created_at
 *
 * 见款发佣则: commission is triggered by erp_mark_invoice_paid only.
 * Invoice creation uses the create_invoice_atomic() RPC which handles
 * invoice_no generation,悲观锁, and atomic line-item insertion.
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

const InvoiceStatus = z.enum(["Pending", "Paid", "Overdue", "Cancelled"]);

export function registerInvoiceTools(server: McpServer) {

  // ── erp_list_invoices ───────────────────────────────────────────────────────
  server.tool(
    "erp_list_invoices",
    "List invoices with optional filters by status, client, sales rep, and created-at date range. Returns invoice totals, region, and payment date.",
    {
      status:     InvoiceStatus.optional().describe("Filter by invoice status"),
      client_id:  z.string().uuid().optional().describe("Filter by client UUID"),
      created_by: z.string().uuid().optional().describe("Filter by sales rep staff UUID"),
      date_from:  z.string().date().optional().describe("Created-at date from (ISO 8601, inclusive)"),
      date_to:    z.string().date().optional().describe("Created-at date to (ISO 8601, inclusive)"),
      limit:      z.number().int().min(1).max(200).default(50),
      offset:     z.number().int().min(0).default(0),
    },
    async ({ status, client_id, created_by, date_from, date_to, limit, offset }) => {
      let q = supabase
        .from("invoices")
        .select(`
          id, invoice_no, status, region,
          delivery_charge, discount, total_amount,
          paid_at, created_at,
          client:clients ( id, name, region ),
          rep:staff!created_by ( id, name, role )
        `, { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (status)     q = q.eq("status", status);
      if (client_id)  q = q.eq("client_id", client_id);
      if (created_by) q = q.eq("created_by", created_by);
      if (date_from)  q = q.gte("created_at", date_from);
      if (date_to)    q = q.lte("created_at", date_to);

      const { data, error, count } = await q;
      if (error) return err(error.message);
      return ok({ total: count, offset, limit, invoices: data });
    }
  );

  // ── erp_get_invoice ─────────────────────────────────────────────────────────
  server.tool(
    "erp_get_invoice",
    "Fetch a single invoice by UUID, including all line items with product details.",
    {
      id: z.string().uuid().describe("Invoice UUID"),
    },
    async ({ id }) => {
      const { data: invoice, error: iErr } = await supabase
        .from("invoices")
        .select(`
          id, invoice_no, status, region,
          delivery_charge, discount, total_amount,
          paid_at, created_at,
          client:clients ( id, name, region, contact_person, contact_phone ),
          rep:staff!created_by ( id, name, role )
        `)
        .eq("id", id)
        .maybeSingle();

      if (iErr)     return err(iErr.message);
      if (!invoice) return err(`No invoice found with id=${id}`);

      const { data: lines, error: lErr } = await supabase
        .from("invoice_items")
        .select(`
          id, qty, selling_price, cost_price_snapshot, created_at,
          product:products ( id, name, sku, category )
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
    [
      "Create a new invoice using the create_invoice_atomic() RPC.",
      "This RPC handles: invoice_no generation, pessimistic locking, and atomic line-item insertion.",
      "selling_price per item defaults to the product's suggested_price if left null.",
    ].join(" "),
    {
      client_id:       z.string().uuid().describe("Client UUID"),
      created_by:      z.string().uuid().describe("Staff UUID of the sales rep"),
      discount:        z.number().min(0).default(0).describe("Invoice-level discount amount in RM"),
      delivery_charge: z.number().min(0).default(0).describe("Delivery charge in RM"),
      is_joint_order:  z.boolean().default(false).describe("Whether this is a joint order (splits commission)"),
      co_created_by:   z.string().uuid().optional().describe("Second staff UUID for joint orders"),
      line_items: z.array(z.object({
        product_id:    z.string().uuid().describe("Product UUID"),
        qty:           z.number().int().positive().describe("Quantity"),
        selling_price: z.number().positive().optional().describe("Override selling price — null uses product suggested_price"),
      })).min(1).describe("At least one line item required"),
    },
    async ({ client_id, created_by, discount, delivery_charge, is_joint_order, co_created_by, line_items }) => {
      const { data, error } = await supabase.rpc("create_invoice_atomic", {
        p_client_id:       client_id,
        p_created_by:      created_by,
        p_items:           line_items.map(l => ({
          product_id:    l.product_id,
          qty:           l.qty,
          selling_price: l.selling_price ?? null,
        })),
        p_discount:        discount,
        p_delivery_charge: delivery_charge,
        p_is_joint_order:  is_joint_order,
        p_co_created_by:   co_created_by ?? null,
      });

      if (error) return err(`create_invoice_atomic failed: ${error.message}`);
      return ok({ created: true, invoice: data });
    }
  );

  // ── erp_mark_invoice_paid ───────────────────────────────────────────────────
  server.tool(
    "erp_mark_invoice_paid",
    [
      "Mark an invoice as Paid and record paid_at.",
      "⚠️  见款发佣则 (Paid-then-commission): This triggers fn_check_bounty_tiers automatically.",
      "Only Pending or Overdue invoices can be marked Paid.",
      "Cancelled invoices are rejected.",
    ].join(" "),
    {
      id:      z.string().uuid().describe("Invoice UUID"),
      paid_at: z.string().date().describe("Date payment was received (YYYY-MM-DD)"),
    },
    async ({ id, paid_at }) => {
      // Guard: fetch current status first
      const { data: current, error: fErr } = await supabase
        .from("invoices")
        .select("id, status, invoice_no, total_amount")
        .eq("id", id)
        .maybeSingle();

      if (fErr)     return err(fErr.message);
      if (!current) return err(`No invoice found with id=${id}`);
      if (current.status === "Paid")      return ok({ already_paid: true, invoice: current });
      if (current.status === "Cancelled") return err(`Invoice ${current.invoice_no} is Cancelled and cannot be marked Paid.`);

      const { data: updated, error: uErr } = await supabase
        .from("invoices")
        .update({ status: "Paid", paid_at })
        .eq("id", id)
        .select("id, invoice_no, status, paid_at, total_amount")
        .single();

      if (uErr) return err(uErr.message);
      return ok({
        marked_paid: true,
        invoice:     updated,
        message:     "Invoice marked Paid. fn_check_bounty_tiers trigger will fire automatically.",
      });
    }
  );
}
