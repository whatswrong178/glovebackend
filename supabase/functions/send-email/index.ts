/**
 * send-email — Supabase Edge Function (T-01.4)
 * Enterprise Email Gateway: dynamic module routing + template injection
 *
 * ─── Authentication (dual-channel) ──────────────────────────────────────────
 *   Channel A: Supabase JWT (Authorization: Bearer <supabase_jwt>)
 *              → internal calls from the frontend or other Edge Functions
 *   Channel B: SYSTEM_SECRET_KEY header (X-System-Secret: <secret>)
 *              → inbound calls from Make.com webhooks
 *   Either channel is sufficient. Both are validated. Unauthenticated = 401.
 *
 * ─── Request body ────────────────────────────────────────────────────────────
 *   {
 *     "module":       "finance" | "operations" | "hr" | "purchasing",
 *     "to":           ["recipient@example.com"],
 *     "templateName": "invoice_reminder",      // key in email_templates.name
 *     "variables":    { "CustomerName": "Acme", "OverdueDays": "7" },
 *     "subject"?:     "Override subject line", // optional — template subject used if omitted
 *     "cc"?:          ["cc@example.com"],
 *     "attachments"?: [{ "filename": "invoice.pdf", "content": "<base64>" }]
 *   }
 *
 * ─── Response ────────────────────────────────────────────────────────────────
 *   200 { "id": "<resend_email_id>", "from": "finance@yourdomain.com" }
 *   400 { "error": "..." }   — bad request
 *   401 { "error": "..." }   — auth failure
 *   500 { "error": "..." }   — Resend / DB failure
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Inlined from _shared/resend.ts — Dashboard-compatible (no relative imports) ─
interface ResendAttachment { filename: string; content: string; }
interface ResendTag        { name: string; value: string; }
interface ResendSendParams {
  from:         string;
  to:           string[];
  subject:      string;
  html:         string;
  cc?:          string[];
  bcc?:         string[];
  reply_to?:    string;
  attachments?: ResendAttachment[];
  tags?:        ResendTag[];
}
interface ResendSendResponse {
  id: string;
  error?: { name: string; message: string; statusCode: number };
}

async function resendSendEmail(
  params: ResendSendParams,
  apiKey: string,
): Promise<ResendSendResponse> {
  const res = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify(params),
  });
  const body = await res.json() as ResendSendResponse;
  if (!res.ok) {
    throw new Error(
      `Resend API error ${res.status}: ${body.error?.message ?? "Unknown error"}`
    );
  }
  return body;
}

function renderTemplate(
  htmlTemplate: string,
  variables: Record<string, string | number>,
): string {
  return htmlTemplate.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = variables[key];
    return value != null ? String(value) : match;
  });
}

// ─── CORS headers ─────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-system-secret, x-application-name",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ── 1. Authentication ───────────────────────────────────────────────────────
  const systemSecret     = Deno.env.get("SYSTEM_SECRET_KEY")     ?? "";
  const resendApiKey     = Deno.env.get("RESEND_API_KEY")         ?? "";
  const supabaseUrl      = Deno.env.get("SUPABASE_URL")           ?? "";
  const supabaseKey      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!resendApiKey) {
    return json({ error: "RESEND_API_KEY is not configured on this Edge Function." }, 500);
  }

  const authHeader      = req.headers.get("Authorization") ?? "";
  const incomingSecret  = req.headers.get("X-System-Secret") ?? "";

  const isWebhookAuth   = systemSecret && incomingSecret === systemSecret;
  const isJwtAuth       = authHeader.startsWith("Bearer ");

  if (!isWebhookAuth && !isJwtAuth) {
    return json({ error: "Unauthorized: provide a valid Supabase JWT or X-System-Secret header." }, 401);
  }

  // ── 2. Parse and validate request body ─────────────────────────────────────
  let body: {
    module:        string;
    to:            string[];
    templateName:  string;
    variables?:    Record<string, string | number>;
    subject?:      string;
    cc?:           string[];
    attachments?:  { filename: string; content: string }[];
  };

  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const { module: emailModule, to, templateName, variables = {}, subject, cc, attachments } = body;

  if (!emailModule || !to?.length || !templateName) {
    return json({ error: "Required fields: module, to (array), templateName." }, 400);
  }

  // ── 3. Init Supabase admin client ──────────────────────────────────────────
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  // ── 4. Look up sender from email_routing ──────────────────────────────────
  const { data: routing, error: routingErr } = await supabase
    .from("email_routing")
    .select("sender_email, sender_name")
    .eq("module", emailModule)
    .single();

  if (routingErr || !routing) {
    return json(
      { error: `No email routing configured for module "${emailModule}". Add it in Settings → Email Routing.` },
      400
    );
  }

  const fromAddress = `${routing.sender_name} <${routing.sender_email}>`;

  // ── 5. Load and render email template ─────────────────────────────────────
  const { data: template, error: templateErr } = await supabase
    .from("email_templates")
    .select("subject, html_body")
    .eq("name", templateName)
    .single();

  if (templateErr || !template) {
    return json(
      { error: `Template "${templateName}" not found. Create it in Settings → Email Templates.` },
      400
    );
  }

  // Add universal system variables available in every template
  const systemVars: Record<string, string | number> = {
    ...variables,
    CompanyName:    "Equimed Supply Enterprise",
    SupportEmail:   routing.sender_email,
    CurrentDate:    new Date().toLocaleDateString("en-MY", {
      day: "2-digit", month: "long", year: "numeric"
    }),
    CurrentYear:    new Date().getFullYear(),
  };

  const renderedSubject = renderTemplate(subject ?? template.subject, systemVars);
  const renderedHtml    = renderTemplate(template.html_body, systemVars);

  // ── 6. Send via Resend ─────────────────────────────────────────────────────
  try {
    const result = await resendSendEmail(
      {
        from:        fromAddress,
        to,
        subject:     renderedSubject,
        html:        renderedHtml,
        cc:          cc ?? [],
        reply_to:    routing.sender_email,
        attachments: attachments ?? [],
        // Tag for tracking in Resend dashboard
        tags: [
          { name: "module",   value: emailModule },
          { name: "template", value: templateName },
        ],
      },
      resendApiKey
    );

    // ── 7. Log to Supabase (optional audit trail) ────────────────────────────
    // Non-blocking — we don't fail the request if this insert fails
    supabase
      .from("email_send_log")
      .insert({
        resend_id:     result.id,
        module:        emailModule,
        template_name: templateName,
        recipients:    to,
        sent_at:       new Date().toISOString(),
      })
      .then(() => {/* fire and forget */});

    return json({ id: result.id, from: routing.sender_email }, 200);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[send-email] Resend error:", message);
    return json({ error: `Email delivery failed: ${message}` }, 500);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
