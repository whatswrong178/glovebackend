/**
 * tools/assessment.ts
 * MCP tools for the `needs_assessments` table.
 *
 * Registered tools:
 *   erp_list_needs_assessments  — paginated list with temperature / staff / date filters
 *   erp_get_needs_assessment    — single assessment by id, full detail
 *   erp_create_needs_assessment — insert a new assessment + auto-link client (destructive)
 *
 * Lead scoring mirrors computeLeadScore() in the frontend:
 *   ≥ 70 = Hot · 40–69 = Warm · < 40 = Cold
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

// ── Lead scoring (server-side mirror) ─────────────────────────────────────────

function computeLeadScore(data: {
  monthly_usage?:     string;
  pain_points?:       string[];
  switch_conditions?: string[];
  satisfaction?:      number;
  today_actions?:     string[];
  priorities?:        string[];
}): { score: number; temperature: "Hot" | "Warm" | "Cold" } {
  let score = 0;

  // Monthly usage: 0–25 pts
  const usageMap: Record<string, number> = {
    "< 1箱": 5, "1–3箱": 12, "4–10箱": 20, "> 10箱": 25,
  };
  if (data.monthly_usage && usageMap[data.monthly_usage]) {
    score += usageMap[data.monthly_usage];
  }

  // Pain points: up to 25 pts (5 per pain point, max 5)
  const pp = data.pain_points ?? [];
  score += Math.min(pp.length * 5, 25);

  // Switch conditions: up to 20 pts (5 per condition, max 4)
  const sc = data.switch_conditions ?? [];
  score += Math.min(sc.length * 5, 20);

  // Satisfaction inverse: unhappy = more room to win (max 15 pts)
  if (data.satisfaction != null) {
    score += Math.max(0, (5 - data.satisfaction) * 3);
  }

  // Today actions: 10 pts if any action chosen
  if ((data.today_actions ?? []).length > 0) score += 10;

  // Priorities alignment: 5 pts if any priorities listed
  if ((data.priorities ?? []).length > 0) score += 5;

  score = Math.min(100, Math.max(0, score));
  const temperature: "Hot" | "Warm" | "Cold" =
    score >= 70 ? "Hot" : score >= 40 ? "Warm" : "Cold";

  return { score, temperature };
}

// ── Tool registration ──────────────────────────────────────────────────────────

export function registerAssessmentTools(server: McpServer) {

  // ── erp_list_needs_assessments ──────────────────────────────────────────────
  server.tool(
    "erp_list_needs_assessments",
    "List customer needs assessments. Filter by lead temperature, sales rep, region, or date range. Returns linked client and key scoring fields.",
    {
      temperature: z.enum(["Hot", "Warm", "Cold"]).optional().describe("Filter by lead temperature"),
      created_by:  z.string().uuid().optional().describe("Filter by sales rep staff UUID"),
      client_id:   z.string().uuid().optional().describe("Filter by linked client UUID"),
      region:      z.enum(["West Malaysia", "East Malaysia"]).optional(),
      date_from:   z.string().date().optional().describe("Visit date from (YYYY-MM-DD, inclusive)"),
      date_to:     z.string().date().optional().describe("Visit date to (YYYY-MM-DD, inclusive)"),
      limit:       z.number().int().min(1).max(200).default(50),
      offset:      z.number().int().min(0).default(0),
    },
    async ({ temperature, created_by, client_id, region, date_from, date_to, limit, offset }) => {
      let q = supabase
        .from("needs_assessments")
        .select(`
          id, visit_date, shop_name, region, lead_temperature, lead_score,
          monthly_usage, industry, sales_notes, created_at,
          client:clients ( id, name ),
          rep:staff!created_by ( id, name )
        `, { count: "exact" })
        .order("visit_date", { ascending: false })
        .range(offset, offset + limit - 1);

      if (temperature) q = q.eq("lead_temperature", temperature);
      if (created_by)  q = q.eq("created_by", created_by);
      if (client_id)   q = q.eq("client_id", client_id);
      if (region)      q = q.eq("region", region);
      if (date_from)   q = q.gte("visit_date", date_from);
      if (date_to)     q = q.lte("visit_date", date_to);

      const { data, error, count } = await q;
      if (error) return err(error.message);
      return ok({ total: count, offset, limit, assessments: data });
    }
  );

  // ── erp_get_needs_assessment ────────────────────────────────────────────────
  server.tool(
    "erp_get_needs_assessment",
    "Fetch a single needs assessment by UUID with all sections: industry, usage, procurement, pain points, switch willingness, next actions, and lead score.",
    {
      id: z.string().uuid().describe("Needs assessment UUID"),
    },
    async ({ id }) => {
      const { data, error } = await supabase
        .from("needs_assessments")
        .select(`
          id, visit_date, shop_name, region,
          contact_name, contact_whatsapp, contact_email, contact_address,
          industry,
          monthly_usage, glove_types, glove_sizes,
          supplier_sources, price_range, reorder_timing,
          pain_points, priorities,
          switch_conditions, decision_maker, satisfaction,
          next_reorder, today_actions, sales_notes,
          lead_score, lead_temperature, created_at,
          client:clients ( id, name ),
          rep:staff!created_by ( id, name, role )
        `)
        .eq("id", id)
        .maybeSingle();

      if (error) return err(error.message);
      if (!data)  return err(`No assessment found with id=${id}`);
      return ok(data);
    }
  );

  // ── erp_create_needs_assessment ─────────────────────────────────────────────
  server.tool(
    "erp_create_needs_assessment",
    "Create a needs assessment from a completed sales visit. Automatically computes lead_score and lead_temperature. Performs client find-or-create by shop_name+owner.",
    {
      // Header
      created_by:       z.string().uuid().describe("Staff UUID of the submitting sales rep"),
      shop_name:        z.string().min(1),
      region:           z.enum(["West Malaysia", "East Malaysia"]),
      visit_date:       z.string().date().default(new Date().toISOString().slice(0, 10)),
      contact_name:     z.string().optional(),
      contact_whatsapp: z.string().optional(),
      contact_email:    z.string().email().optional(),
      contact_address:  z.string().optional(),
      // S1
      industry:         z.string().optional(),
      // S2
      monthly_usage:    z.string().optional(),
      glove_types:      z.array(z.string()).default([]),
      glove_sizes:      z.array(z.string()).default([]),
      // S3
      supplier_sources: z.array(z.string()).default([]),
      price_range:      z.string().optional(),
      reorder_timing:   z.string().optional(),
      // S4
      pain_points:      z.array(z.string()).default([]),
      priorities:       z.array(z.string()).default([]),
      // S5
      switch_conditions: z.array(z.string()).default([]),
      decision_maker:   z.string().optional(),
      satisfaction:     z.number().int().min(1).max(5).optional(),
      // S6
      next_reorder:     z.string().optional(),
      today_actions:    z.array(z.string()).default([]),
      sales_notes:      z.string().optional(),
    },
    async (args) => {
      const { score, temperature } = computeLeadScore({
        monthly_usage:     args.monthly_usage,
        pain_points:       args.pain_points,
        switch_conditions: args.switch_conditions,
        satisfaction:      args.satisfaction,
        today_actions:     args.today_actions,
        priorities:        args.priorities,
      });

      // Find-or-create client
      let clientId: string | null = null;
      const { data: existingClient } = await supabase
        .from("clients")
        .select("id")
        .ilike("name", args.shop_name.trim())
        .eq("owner_id", args.created_by)
        .maybeSingle();

      if (existingClient) {
        clientId = existingClient.id;
      } else {
        const newClientPayload: Record<string, unknown> = {
          name:     args.shop_name.trim(),
          region:   args.region,
          owner_id: args.created_by,
        };
        if (args.contact_name)     newClientPayload.contact_person = args.contact_name;
        if (args.contact_whatsapp) newClientPayload.contact_phone  = args.contact_whatsapp;
        if (args.contact_email)    newClientPayload.contact_email  = args.contact_email;

        const { data: newClient, error: cErr } = await supabase
          .from("clients")
          .insert(newClientPayload)
          .select("id")
          .single();

        if (cErr) return err(`Client creation failed: ${cErr.message}`);
        clientId = newClient.id;
      }

      // Insert assessment
      const { data, error } = await supabase
        .from("needs_assessments")
        .insert({
          client_id:        clientId,
          created_by:       args.created_by,
          visit_date:       args.visit_date,
          shop_name:        args.shop_name.trim(),
          region:           args.region,
          contact_name:     args.contact_name     ?? null,
          contact_whatsapp: args.contact_whatsapp ?? null,
          contact_email:    args.contact_email    ?? null,
          contact_address:  args.contact_address  ?? null,
          industry:         args.industry         ?? null,
          monthly_usage:    args.monthly_usage    ?? null,
          glove_types:      args.glove_types,
          glove_sizes:      args.glove_sizes,
          supplier_sources: args.supplier_sources,
          price_range:      args.price_range      ?? null,
          reorder_timing:   args.reorder_timing   ?? null,
          pain_points:      args.pain_points,
          priorities:       args.priorities,
          switch_conditions:args.switch_conditions,
          decision_maker:   args.decision_maker   ?? null,
          satisfaction:     args.satisfaction     ?? null,
          next_reorder:     args.next_reorder     ?? null,
          today_actions:    args.today_actions,
          sales_notes:      args.sales_notes      ?? null,
          lead_score:       score,
          lead_temperature: temperature,
        })
        .select("id, lead_score, lead_temperature, client_id")
        .single();

      if (error) return err(error.message);
      return ok({
        created:         true,
        assessment:      data,
        client_id:       clientId,
        client_created:  !existingClient,
      });
    }
  );
}
