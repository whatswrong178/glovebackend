/**
 * supabase.ts
 * Service-role Supabase client for MCP server.
 * Uses service_role key → bypasses all RLS policies.
 * NEVER expose this client or key to the browser/frontend.
 */
import { createClient } from "@supabase/supabase-js";

const url  = process.env.SUPABASE_URL;
const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error(
    "[hermes-erp-mcp] Missing env vars: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY"
  );
}

export const supabase = createClient(url, key, {
  auth: {
    // Service-role client must never try to refresh a user session
    persistSession:   false,
    autoRefreshToken: false,
  },
});
