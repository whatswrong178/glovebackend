import { createClient } from "@supabase/supabase-js";

// These two variables are the only Supabase credentials that belong in the
// frontend bundle. The anon key is safe: it cannot bypass RLS policies.
const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnon) {
  throw new Error(
    "[supabaseClient] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set. " +
    "Copy .env.example → .env and fill in your project credentials."
  );
}

export const supabaseClient = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    // Persist session in localStorage so the user stays logged in on refresh
    persistSession: true,
    // Automatically refresh the JWT before it expires
    autoRefreshToken: true,
    // Detect session from URL hash after magic-link / OAuth redirects
    detectSessionInUrl: true,
  },
  db: {
    schema: "public",
  },
  global: {
    headers: {
      // Add a custom header so Supabase logs can identify requests from this app
      "x-application-name": "mediglove-erp",
    },
  },
});
