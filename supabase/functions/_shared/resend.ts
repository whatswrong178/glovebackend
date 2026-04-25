/**
 * Resend API Client — Shared Edge Function Utility (T-01.4)
 *
 * Thin wrapper around the Resend v1 REST API.
 * Uses fetch() directly — no npm packages (Deno Edge Function constraint).
 *
 * Docs: https://resend.com/docs/api-reference/emails/send-email
 */

const RESEND_API_BASE = "https://api.resend.com";

export interface ResendSendParams {
  from:        string;         // "Display Name <sender@yourdomain.com>"
  to:          string[];       // recipient email addresses
  subject:     string;
  html:        string;         // rendered HTML body
  cc?:         string[];
  bcc?:        string[];
  reply_to?:   string;
  attachments?: ResendAttachment[];
  tags?:        ResendTag[];
}

export interface ResendAttachment {
  filename: string;
  content:  string;   // base64-encoded file content
}

export interface ResendTag {
  name:  string;
  value: string;
}

export interface ResendSendResponse {
  id:    string;   // Resend email ID (for tracking)
  error?: {
    name:    string;
    message: string;
    statusCode: number;
  };
}

export async function resendSendEmail(
  params: ResendSendParams,
  apiKey: string
): Promise<ResendSendResponse> {
  const res = await fetch(`${RESEND_API_BASE}/emails`, {
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

/**
 * renderTemplate — Replaces {{VariableName}} placeholders in an HTML template.
 * Variables are case-sensitive. Unknown variables are left as-is.
 *
 * @example
 *   renderTemplate("<p>Hello {{CustomerName}}</p>", { CustomerName: "Acme Corp" })
 *   // → "<p>Hello Acme Corp</p>"
 */
export function renderTemplate(
  htmlTemplate: string,
  variables: Record<string, string | number>
): string {
  return htmlTemplate.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = variables[key];
    return value != null ? String(value) : match;
  });
}
