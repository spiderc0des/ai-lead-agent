import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses RLS entirely — this is the only path that may
 * write to any domain table.
 *
 * `import "server-only"` makes a stray client-side import a build error, and
 * the key deliberately has no NEXT_PUBLIC_ prefix so it can never be inlined
 * into the browser bundle.
 */
let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env.local and fill it in.",
    );
  }

  // supabase-js appends /rest/v1, /auth/v1 and friends itself. A URL that
  // already carries a path yields requests to /rest/v1/rest/v1/… whose errors
  // never mention the real cause, so fail loudly here instead.
  const origin = new URL(url).origin;
  if (new URL(url).pathname.replace(/\/$/, "") !== "") {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL must be the bare project URL with no path. Got ${url}; use ${origin}.`,
    );
  }

  cached = createClient(origin, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
