/**
 * create-staff-user — Supabase Edge Function
 * MediGlove ERP · EPIC-02 / T-02.1
 *
 * Creates a Supabase Auth user for an existing staff record, then emails
 * the temporary credentials to the new staff member.
 *
 * ─── Auth ────────────────────────────────────────────────────────────────────
 *   Authorization: Bearer <supabase_jwt>   (caller must be Admin or HR)
 *
 * ─── Request body ────────────────────────────────────────────────────────────
 *   { staff_id: string (UUID), email: string, name: string }
 *
 * ─── Response ────────────────────────────────────────────────────────────────
 *   200 { auth_user_id: string, email_sent: boolean }
 *   400 { error: string }
 *   401 { error: string }
 *   403 { error: string }
 *   409 { error: string }   — auth user already exists for this staff
 *   500 { error: string }
 *
 * ─── Env vars (set via: supabase secrets set KEY=VALUE) ─────────────────────
 *   SUPABASE_URL              (auto-injected by runtime)
 *   SUPABASE_SERVICE_ROLE_KEY (auto-injected by runtime)
 *   RESEND_API_KEY            required for email
 *   FRONTEND_URL              optional — login URL in email (default: https://erp.mediglove.com)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resendSendEmail } from "../_shared/resend.ts";

// ─── CORS ─────────────────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Password charset (uppercase + lowercase + digits — no ambiguous chars) ───
const PWD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const PWD_LEN   = 12;

function generateTempPassword(): string {
  const bytes  = new Uint8Array(PWD_LEN);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => PWD_CHARS[b % PWD_CHARS.length]).join("");
}

// ─── Welcome email HTML ───────────────────────────────────────────────────────
function buildWelcomeHtml(params: {
  name:        string;
  email:       string;
  password:    string;
  loginUrl:    string;
  companyName: string;
}): string {
  const { name, email, password, loginUrl, companyName } = params;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Welcome to ${companyName} ERP</title>
</head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f6f8;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:12px;overflow:hidden;
                      box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#1d4ed8;padding:28px 32px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">
                ${companyName}
              </p>
              <p style="margin:4px 0 0;font-size:13px;color:#93c5fd;">ERP System — Staff Portal</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#111827;">
                Welcome aboard, ${name}! 👋
              </p>
              <p style="margin:0 0 24px;font-size:14px;color:#4b5563;line-height:1.6;">
                Your account has been created on the <strong>${companyName} ERP</strong> system.
                Below are your login credentials. Please log in and
                <strong>change your password immediately</strong>.
              </p>

              <!-- Credentials box -->
              <table width="100%" cellpadding="0" cellspacing="0"
                     style="background:#f0f9ff;border:1px solid #bae6fd;
                            border-radius:8px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 12px;font-size:11px;font-weight:700;
                               color:#0369a1;text-transform:uppercase;letter-spacing:1px;">
                      Your Login Credentials
                    </p>
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:13px;color:#6b7280;padding-bottom:8px;
                                   min-width:130px;">Email address</td>
                        <td style="font-size:13px;font-weight:700;color:#111827;
                                   padding-bottom:8px;">${email}</td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#6b7280;">Temporary password</td>
                        <td style="font-size:15px;font-weight:700;color:#1d4ed8;
                                   font-family:monospace;letter-spacing:2px;">${password}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:#1d4ed8;border-radius:8px;">
                    <a href="${loginUrl}"
                       style="display:inline-block;padding:12px 28px;font-size:14px;
                              font-weight:600;color:#ffffff;text-decoration:none;">
                      Log In Now →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Security note -->
              <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;
                          padding:14px 18px;margin-bottom:24px;">
                <p style="margin:0;font-size:12px;color:#92400e;line-height:1.5;">
                  🔒 <strong>Security reminder:</strong> This email contains a temporary password.
                  Never share your credentials with anyone. Change your password immediately after
                  your first login.
                </p>
              </div>

              <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
                If you have any issues logging in, contact your system administrator.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;
                       padding:16px 32px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#9ca3af;">
                This is an automated message from ${companyName} ERP.
                Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ── 1. Env vars ─────────────────────────────────────────────────────────────
  const supabaseUrl     = Deno.env.get("SUPABASE_URL")             ?? "";
  const serviceRoleKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const resendApiKey    = Deno.env.get("RESEND_API_KEY")            ?? "";
  const frontendUrl     = Deno.env.get("FRONTEND_URL")              ?? "https://erp.mediglove.com";

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Supabase env vars not configured." }, 500);
  }

  // ── 2. Verify caller JWT (must be Admin or HR) ───────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Unauthorized: missing Bearer token." }, 401);
  }
  const callerJwt = authHeader.slice(7);

  // Service-role admin client (bypasses RLS — used for admin operations)
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Verify caller identity via their JWT
  const { data: callerData, error: callerErr } = await adminClient.auth.getUser(callerJwt);
  if (callerErr || !callerData.user) {
    return json({ error: "Unauthorized: invalid token." }, 401);
  }

  // Look up caller's staff role
  const { data: callerStaff, error: staffLookupErr } = await adminClient
    .from("staff")
    .select("role")
    .eq("auth_user_id", callerData.user.id)
    .single();

  if (staffLookupErr || !callerStaff) {
    return json({ error: "Unauthorized: caller not found in staff table." }, 401);
  }

  if (!["Admin", "HR"].includes(callerStaff.role)) {
    return json({ error: "Forbidden: only Admin or HR may create staff credentials." }, 403);
  }

  // ── 3. Parse request body ───────────────────────────────────────────────────
  let body: { staff_id: string; email: string; name: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const { staff_id, email, name } = body;
  if (!staff_id || !email || !name) {
    return json({ error: "Required fields: staff_id, email, name." }, 400);
  }

  // ── 4. Guard: check if staff already has auth_user_id ───────────────────────
  const { data: existingStaff, error: existingErr } = await adminClient
    .from("staff")
    .select("auth_user_id")
    .eq("id", staff_id)
    .single();

  if (existingErr) {
    return json({ error: `Staff record not found: ${existingErr.message}` }, 400);
  }

  if (existingStaff.auth_user_id) {
    return json({ error: "This staff member already has a login account." }, 409);
  }

  // ── 5. Generate temp password ────────────────────────────────────────────────
  const tempPassword = generateTempPassword();

  // ── 6. Create Supabase Auth user ─────────────────────────────────────────────
  const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
    email,
    password:      tempPassword,
    email_confirm: true,           // skip email verification step
    user_metadata: { name, staff_id },
  });

  if (authErr || !authData.user) {
    // Common case: email already registered in auth.users
    const msg = authErr?.message ?? "Unknown auth error";
    if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("exists")) {
      return json({ error: `An auth account already exists for ${email}. Use the dashboard to link it manually.` }, 409);
    }
    return json({ error: `Failed to create auth user: ${msg}` }, 500);
  }

  const authUserId = authData.user.id;

  // ── 7. Link auth_user_id onto staff row ──────────────────────────────────────
  const { error: updateErr } = await adminClient
    .from("staff")
    .update({ auth_user_id: authUserId })
    .eq("id", staff_id);

  if (updateErr) {
    // Roll back: delete the auth user we just created to avoid orphan accounts
    await adminClient.auth.admin.deleteUser(authUserId);
    return json({ error: `Failed to link auth user to staff: ${updateErr.message}` }, 500);
  }

  // ── 8. Send welcome email (non-fatal if Resend not configured) ───────────────
  let emailSent = false;
  let emailError: string | null = null;

  if (resendApiKey) {
    try {
      // Resolve HR email routing for the "from" address
      const { data: routing } = await adminClient
        .from("email_routing")
        .select("sender_email, sender_name")
        .eq("module", "hr")
        .maybeSingle();

      const fromAddress = routing
        ? `${routing.sender_name} <${routing.sender_email}>`
        : `MediGlove HR <hr@mediglove.com>`;

      // Fetch company name from company_settings
      const { data: settings } = await adminClient
        .from("company_settings")
        .select("company_name")
        .maybeSingle();

      const companyName = settings?.company_name ?? "MediGlove Supply Sdn. Bhd.";

      const html = buildWelcomeHtml({
        name,
        email,
        password: tempPassword,
        loginUrl: frontendUrl,
        companyName,
      });

      const result = await resendSendEmail(
        {
          from:    fromAddress,
          to:      [email],
          subject: `Welcome to ${companyName} ERP — Your Login Credentials`,
          html,
          tags:    [{ name: "module", value: "hr" }, { name: "template", value: "staff_welcome" }],
        },
        resendApiKey
      );

      // Audit log (fire and forget)
      adminClient
        .from("email_send_log")
        .insert({
          resend_id:     result.id,
          module:        "hr",
          template_name: "staff_welcome",
          recipients:    [email],
          sent_at:       new Date().toISOString(),
        })
        .then(() => {/* non-blocking */});

      emailSent = true;

    } catch (err: unknown) {
      emailError = err instanceof Error ? err.message : String(err);
      console.error("[create-staff-user] Email send failed:", emailError);
      // Auth account + staff link are already committed — don't fail the whole request
    }
  } else {
    emailError = "RESEND_API_KEY not configured — credentials not emailed.";
    console.warn("[create-staff-user]", emailError);
  }

  return json(
    {
      auth_user_id: authUserId,
      email_sent:   emailSent,
      ...(emailError ? { email_warning: emailError } : {}),
    },
    200
  );
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
