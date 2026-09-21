import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Anon-key client carrying the caller's session cookies. RLS applies, so this
 * sees exactly what the signed-in user is allowed to see. Use it for reads and
 * for identifying the caller; never for privileged writes.
 */
export async function supabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // middleware.ts refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
}
