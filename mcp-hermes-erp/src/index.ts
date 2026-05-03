/**
 * index.ts — Hermes ↔ MediGlove ERP MCP Server
 *
 * Transport : stdio  (Claude Desktop local use)
 * Auth      : Supabase service_role key (bypasses RLS — admin-level)
 * Protocol  : Model Context Protocol v1.x
 *
 * Tool manifest:
 *   Clients    → erp_list_clients, erp_get_client, erp_create_client
 *   Products   → erp_list_products, erp_get_product
 *   Invoices   → erp_list_invoices, erp_get_invoice,
 *                erp_create_invoice, erp_mark_invoice_paid
 *   Commission → erp_get_dashboard_kpis, erp_calculate_commission, erp_list_staff
 *   Assessment → erp_list_needs_assessments, erp_get_needs_assessment,
 *                erp_create_needs_assessment
 *
 * Usage (after `npm run build`):
 *   node dist/index.js
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { McpServer }          from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerClientTools }     from "./tools/clients.js";
import { registerProductTools }    from "./tools/products.js";
import { registerInvoiceTools }    from "./tools/invoices.js";
import { registerCommissionTools } from "./tools/commission.js";
import { registerAssessmentTools } from "./tools/assessment.js";

// ── Server instantiation ───────────────────────────────────────────────────────

const server = new McpServer({
  name:    "hermes-erp",
  version: "1.0.0",
});

// ── Register all tool domains ──────────────────────────────────────────────────

registerClientTools(server);
registerProductTools(server);
registerInvoiceTools(server);
registerCommissionTools(server);
registerAssessmentTools(server);

// ── Connect via stdio transport ────────────────────────────────────────────────

const transport = new StdioServerTransport();

await server.connect(transport);

// stderr only — stdout is reserved for MCP JSON-RPC
process.stderr.write(
  `[hermes-erp-mcp] Server ready. Tools registered: ${[
    "erp_list_clients", "erp_get_client", "erp_create_client",
    "erp_list_products", "erp_get_product",
    "erp_list_invoices", "erp_get_invoice", "erp_create_invoice", "erp_mark_invoice_paid",
    "erp_get_dashboard_kpis", "erp_calculate_commission", "erp_list_staff",
    "erp_list_needs_assessments", "erp_get_needs_assessment", "erp_create_needs_assessment",
  ].join(", ")}\n`
);
