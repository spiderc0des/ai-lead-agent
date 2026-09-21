"use client";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser client. Holds the anon key, so every query it makes is filtered by
 * the RLS policies in 0002_auth_rls.sql: own rows, or everything for an admin.
 * There are no write policies, so this client can only read.
 */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
