/**
 * tools/products.ts
 * MCP tools for the `products` table.
 *
 * Registered tools:
 *   erp_list_products  — paginated catalogue with optional search + category filter
 *   erp_get_product    — single product by id or SKU
 *
 * Actual DB columns (migrations/001 + 009 + 020):
 *   id, name, sku, supplier_id, category,
 *   cost_price, min_selling_price, suggested_price,
 *   description, units_per_carton, created_at
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

export function registerProductTools(server: McpServer) {

  // ── erp_list_products ───────────────────────────────────────────────────────
  server.tool(
    "erp_list_products",
    "List products in the MediGlove ERP catalogue. Supports search by name/SKU and optional category filter. Returns cost_price, min_selling_price, suggested_price, and units_per_carton.",
    {
      search:   z.string().optional().describe("Substring search on product name or SKU"),
      category: z.string().optional().describe("Filter by product category (e.g. 'Nitrile', 'Latex')"),
      limit:    z.number().int().min(1).max(200).default(50),
      offset:   z.number().int().min(0).default(0),
    },
    async ({ search, category, limit, offset }) => {
      let q = supabase
        .from("products")
        .select(
          `id, name, sku, category,
           cost_price, min_selling_price, suggested_price,
           description, units_per_carton, created_at`,
          { count: "exact" }
        )
        .order("name")
        .range(offset, offset + limit - 1);

      if (search)   q = q.or(`name.ilike.%${search}%,sku.ilike.%${search}%`);
      if (category) q = q.ilike("category", `%${category}%`);

      const { data, error, count } = await q;
      if (error) return err(error.message);
      return ok({ total: count, offset, limit, products: data });
    }
  );

  // ── erp_get_product ─────────────────────────────────────────────────────────
  server.tool(
    "erp_get_product",
    "Fetch a single product by its UUID or SKU string.",
    {
      id:  z.string().uuid().optional().describe("Product UUID"),
      sku: z.string().optional().describe("Product SKU (alternative to id)"),
    },
    async ({ id, sku }) => {
      if (!id && !sku) return err("Provide either `id` or `sku`.");

      let q = supabase
        .from("products")
        .select(
          `id, name, sku, category,
           cost_price, min_selling_price, suggested_price,
           description, units_per_carton, created_at`
        );

      if (id)  q = q.eq("id", id!);
      else     q = q.eq("sku", sku!);

      const { data, error } = await q.maybeSingle();
      if (error)  return err(error.message);
      if (!data)  return err(`No product found for ${id ? `id=${id}` : `sku=${sku}`}`);
      return ok(data);
    }
  );
}
