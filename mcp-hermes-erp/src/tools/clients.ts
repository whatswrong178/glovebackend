/**
 * tools/clients.ts
 * MCP tools for the `clients` table.
 *
 * Registered tools:
 *   erp_list_clients        — paginated list with optional search + region filter
 *   erp_get_client          — single client by id, with owner staff details
 *   erp_create_client       — insert a new client record (find-or-create safe)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z }         from "zod";
import { supabase }  from "../supabase.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function ok(data: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(msg: string): { content: { type: "text"; text: string }[]; isError: true } {
  return { content: [{ type: "text", text: `ERROR: ${msg}` }], isError: true };
}

// ── Tool registration ──────────────────────────────────────────────────────────

export function registerClientTools(server: McpServer) {

  // ── erp_list_clients ────────────────────────────────────────────────────────
  server.tool(
    "erp_list_clients",
    "List ERP clients. Supports full-text search on name/contact fields and optional region filter. Returns at most `limit` rows (default 50, max 200).",
    {
      search:  z.string().optional().describe("Substring search on client name or contact person"),
      region:  z.enum(["West Malaysia", "East Malaysia"]).optional().describe("Filter by region"),
      owner_id: z.string().uuid().optional().describe("Filter by sales rep staff UUID"),
      limit:   z.number().int().min(1).max(200).default(50).describe("Max rows to return"),
      offset:  z.number().int().min(0).default(0).describe("Pagination offset"),
    },
    async ({ search, region, owner_id, limit, offset }) => {
      let q = supabase
        .from("clients")
        .select(`
          id, name, region, contact_person, contact_phone, contact_email,
          created_at,
          owner:staff!owner_id ( id, name, role )
        `, { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (search)   q = q.or(`name.ilike.%${search}%,contact_person.ilike.%${search}%`);
      if (region)   q = q.eq("region", region);
      if (owner_id) q = q.eq("owner_id", owner_id);

      const { data, error, count } = await q;
      if (error) return err(error.message);
      return ok({ total: count, offset, limit, clients: data });
    }
  );

  // ── erp_get_client ──────────────────────────────────────────────────────────
  server.tool(
    "erp_get_client",
    "Fetch a single client by UUID, including owner staff info and recent needs assessments.",
    {
      id: z.string().uuid().describe("Client UUID"),
    },
    async ({ id }) => {
      const { data: client, error: cErr } = await supabase
        .from("clients")
        .select(`
          id, name, region, contact_person, contact_phone, contact_email, created_at,
          owner:staff!owner_id ( id, name, role )
        `)
        .eq("id", id)
        .maybeSingle();

      if (cErr)    return err(cErr.message);
      if (!client) return err(`No client found with id=${id}`);

      // Recent assessments for this client
      const { data: assessments } = await supabase
        .from("needs_assessments")
        .select("id, visit_date, lead_temperature, lead_score, sales_notes, created_at")
        .eq("client_id", id)
        .order("visit_date", { ascending: false })
        .limit(5);

      return ok({ ...client, recent_assessments: assessments ?? [] });
    }
  );

  // ── erp_create_client ───────────────────────────────────────────────────────
  server.tool(
    "erp_create_client",
    "Create a new client. Performs a find-or-create: if a client with the same name already exists for the given owner, returns the existing record instead of creating a duplicate.",
    {
      name:           z.string().min(1).describe("Shop / company name"),
      region:         z.enum(["West Malaysia", "East Malaysia"]),
      owner_id:       z.string().uuid().describe("Staff UUID of the sales rep who owns this client"),
      contact_person: z.string().optional().describe("Primary contact name"),
      contact_phone:  z.string().optional().describe("WhatsApp / phone number"),
      contact_email:  z.string().email().optional().describe("Contact email"),
    },
    async ({ name, region, owner_id, contact_person, contact_phone, contact_email }) => {
      // Find-or-create guard
      const { data: existing } = await supabase
        .from("clients")
        .select("id, name, region")
        .ilike("name", name.trim())
        .eq("owner_id", owner_id)
        .maybeSingle();

      if (existing) {
        return ok({ created: false, client: existing, message: "Client already exists — returned existing record." });
      }

      // contact_address and industry do not exist on the clients table — omitted.
      const payload: Record<string, unknown> = {
        name:       name.trim(),
        region,
        owner_id,
        created_by: owner_id, // required NOT NULL column
      };
      if (contact_person) payload.contact_person = contact_person;
      if (contact_phone)  payload.contact_phone  = contact_phone;
      if (contact_email)  payload.contact_email  = contact_email;

      const { data, error } = await supabase
        .from("clients")
        .insert(payload)
        .select()
        .single();

      if (error) return err(error.message);
      return ok({ created: true, client: data });
    }
  );
}
