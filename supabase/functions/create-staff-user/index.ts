/**
 * create-staff-user — Supabase Edge Function
 * MediGlove ERP · EPIC-02 / T-02.1
 *
 * Two modes controlled by the `resend` flag in the request body:
 *
 *   MODE A — Create (resend: false / omitted)
 *     Creates a new Supabase Auth user for a staff record that has no login yet,
 *     links auth_user_id onto the staff row, and emails the temporary credentials.
 *
 *   MODE B — Resend (resend: true)
 *     Resets the password on the existing auth account and re-sends the credential
 *     email. Useful when the staff member lost / never received their initial email.
 *     The caller only needs to supply staff_id — email and name are fetched from DB.
 *
 * ─── Auth ────────────────────────────────────────────────────────────────────
 *   Authorization: Bearer <supabase_jwt>   (caller must be Admin or HR)
 *
 * ─── Request body ────────────────────────────────────────────────────────────
 *   { staff_id: string (UUID), resend?: boolean }
 *
 * ─── Response ────────────────────────────────────────────────────────────────
 *   200 { auth_user_id: string, email_sent: boolean, mode: "created" | "resent" }
 *   400 { error: string }
 *   401 { error: string }
 *   403 { error: string }
 *   409 { error: string }   — create mode: auth user already exists
 *   500 { error: string }
 *
 * ─── Env vars (set via: supabase secrets set KEY=VALUE) ─────────────────────
 *   SUPABASE_URL              (auto-injected by runtime)
 *   SUPABASE_SERVICE_ROLE_KEY (auto-injected by runtime)
 *   RESEND_API_KEY            required for email
 *   FRONTEND_URL              optional — login URL in email (default: https://erp.mediglove.com)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Inlined Resend API helper (no _shared/ import — Dashboard-compatible) ────
interface ResendEmailTag { name: string; value: string; }
interface ResendSendParams {
  from:     string;
  to:       string[];
  subject:  string;
  html:     string;
  tags?:    ResendEmailTag[];
}
interface ResendSendResponse { id: string; [k: string]: unknown; }

async function resendSendEmail(
  params:  ResendSendParams,
  apiKey:  string,
): Promise<ResendSendResponse> {
  const res = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify(params),
  });
  const body = await res.json() as ResendSendResponse & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(
      `Resend API error ${res.status}: ${body.error?.message ?? "Unknown error"}`
    );
  }
  return body;
}

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Auth is enforced via JWT + role check inside the handler — CORS wildcard is safe.
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-application-name",
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

// ─── Email HTML builder ───────────────────────────────────────────────────────
function buildCredentialsHtml(params: {
  name:        string;
  email:       string;
  password:    string;
  loginUrl:    string;
  companyName: string;
  isResend:    boolean;
}): string {
  const { name, email, password, loginUrl, companyName, isResend } = params;
  const title   = isResend ? "Your Login Credentials Have Been Reset" : `Welcome to ${companyName} ERP`;
  const heading = isResend ? `Hi ${name}, your credentials have been reset 🔑` : `Welcome aboard, ${name}! 👋`;
  const subtext = isResend
    ? `Your ERP login password has been reset by an administrator. Use the credentials below to sign in, then <strong>change your password immediately</strong>.`
    : `Your account has been created on the <strong>${companyName} ERP</strong> system. Below are your login credentials. Please log in and <strong>change your password immediately</strong>.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
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
                ${heading}
              </p>
              <p style="margin:0 0 24px;font-size:14px;color:#4b5563;line-height:1.6;">
                ${subtext}
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
                        <td style="font-size:13px;color:#6b7280;">${isResend ? "New temporary password" : "Temporary password"}</td>
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
  const frontendUrl     = Deno.env.get("FRONTEND_URL")              ?? "https://erp.equimedsupply.com";

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Supabase env vars not configured." }, 500);
  }

  // ── 2. Verify caller JWT (must be Admin or HR) ───────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Unauthorized: missing Bearer token." }, 401);
  }
  const callerJwt = authHeader.slice(7);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: callerData, error: callerErr } = await adminClient.auth.getUser(callerJwt);
  if (callerErr || !callerData.user) {
    return json({ error: "Unauthorized: invalid token." }, 401);
  }

  const { data: callerStaff, error: staffLookupErr } = await adminClient
    .from("staff")
    .select("role")
    .eq("auth_user_id", callerData.user.id)
    .single();

  if (staffLookupErr || !callerStaff) {
    return json({ error: "Unauthorized: caller not found in staff table." }, 401);
  }

  if (!["Admin", "HR"].includes(callerStaff.role)) {
    return json({ error: "Forbidden: only Admin or HR may manage staff credentials." }, 403);
  }

  // ── 3. Parse request body ───────────────────────────────────────────────────
  let body: { staff_id: string; resend?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const { staff_id, resend = false } = body;
  if (!staff_id) {
    return json({ error: "Required field: staff_id." }, 400);
  }

  // ── 4. Fetch the full staff row from DB (source of truth for email/name) ────
  const { data: staffRow, error: staffErr } = await adminClient
    .from("staff")
    .select("id, name, email, auth_user_id, status")
    .eq("id", staff_id)
    .single();

  if (staffErr || !staffRow) {
    return json({ error: `Staff record not found: ${staffErr?.message ?? "unknown error"}` }, 400);
  }

  if (staffRow.status === "Inactive") {
    return json({ error: "Cannot provision credentials for an Inactive staff member." }, 400);
  }

  const { name, email, auth_user_id } = staffRow;

  // ── Helper: resolve email routing + company name ─────────────────────────────
  async function getEmailMeta(): Promise<{ fromAddress: string; companyName: string }> {
    const [routingRes, settingsRes] = await Promise.all([
      adminClient.from("email_routing").select("sender_email, sender_name").eq("module", "hr").maybeSingle(),
      adminClient.from("company_settings").select("company_name").maybeSingle(),
    ]);

    const fromAddress = routingRes.data
      ? `${routingRes.data.sender_name} <${routingRes.data.sender_email}>`
      : "Equimed HR <hr@equimedsupply.com>";

    const companyName = settingsRes.data?.company_name ?? "Equimed Supply Enterprise";
    return { fromAddress, companyName };
  }

  // ── Helper: send credential email ────────────────────────────────────────────
  async function sendCredentialEmail(params: {
    authUserId:  string;
    tempPassword: string;
    isResend:    boolean;
  }): Promise<{ emailSent: boolean; emailError: string | null }> {
    if (!resendApiKey) {
      return { emailSent: false, emailError: "RESEND_API_KEY not configured — credentials not emailed." };
    }

    try {
      const { fromAddress, companyName } = await getEmailMeta();

      const html = buildCredentialsHtml({
        name,
        email,
        password:   params.tempPassword,
        loginUrl:   frontendUrl,
        companyName,
        isResend:   params.isResend,
      });

      const subject = params.isResend
        ? `Your ${companyName} ERP Password Has Been Reset`
        : `Welcome to ${companyName} ERP — Your Login Credentials`;

      const result = await resendSendEmail(
        {
          from:    fromAddress,
          to:      [email],
          subject,
          html,
          tags: [
            { name: "module",   value: "hr" },
            { name: "template", value: params.isResend ? "staff_credentials_resend" : "staff_welcome" },
          ],
        },
        resendApiKey
      );

      // Audit log (fire and forget)
      adminClient
        .from("email_send_log")
        .insert({
          resend_id:     result.id,
          module:        "hr",
          template_name: params.isResend ? "staff_credentials_resend" : "staff_welcome",
          recipients:    [email],
          sent_at:       new Date().toISOString(),
        })
        .then(() => {/* non-blocking */});

      return { emailSent: true, emailError: null };

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[create-staff-user] Email send failed:", msg);
      return { emailSent: false, emailError: msg };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MODE A — Resend credentials (staff already has auth_user_id)
  // ════════════════════════════════════════════════════════════════════════════
  if (resend) {
    if (!auth_user_id) {
      return json({
        error: "This staff member has no login account yet. Use 'Create Login' mode first.",
      }, 400);
    }

    // Generate a new temporary password and reset the auth user
    const tempPassword = generateTempPassword();

    const { error: resetErr } = await adminClient.auth.admin.updateUserById(auth_user_id, {
      password: tempPassword,
    });

    if (resetErr) {
      return json({ error: `Failed to reset password: ${resetErr.message}` }, 500);
    }

    const { emailSent, emailError } = await sendCredentialEmail({
      authUserId:   auth_user_id,
      tempPassword,
      isResend:     true,
    });

    return json(
      {
        auth_user_id,
        email_sent: emailSent,
        mode:       "resent",
        ...(emailError ? { email_warning: emailError } : {}),
      },
      200
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MODE B — Create new login (staff has no auth_user_id)
  // ════════════════════════════════════════════════════════════════════════════
  if (auth_user_id) {
    return json({
      error: "This staff member already has a login account. Use resend: true to reset and resend credentials.",
    }, 409);
  }

  // Generate temp password
  const tempPassword = generateTempPassword();

  // Create Supabase Auth user
  const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
    email,
    password:      tempPassword,
    email_confirm: true,
    user_metadata: { name, staff_id },
  });

  if (authErr || !authData.user) {
    const msg = authErr?.message ?? "Unknown auth error";
    if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("exists")) {
      return json({
        error: `An auth account already exists for ${email}. Use the dashboard to link it manually.`,
      }, 409);
    }
    return json({ error: `Failed to create auth user: ${msg}` }, 500);
  }

  const authUserId = authData.user.id;

  // Link auth_user_id onto staff row
  const { error: updateErr } = await adminClient
    .from("staff")
    .update({ auth_user_id: authUserId })
    .eq("id", staff_id);

  if (updateErr) {
    // Roll back: delete the orphan auth user
    await adminClient.auth.admin.deleteUser(authUserId);
    return json({ error: `Failed to link auth user to staff: ${updateErr.message}` }, 500);
  }

  const { emailSent, emailError } = await sendCredentialEmail({
    authUserId,
    tempPassword,
    isResend: false,
  });

  return json(
    {
      auth_user_id: authUserId,
      email_sent:   emailSent,
      mode:         "created",
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
