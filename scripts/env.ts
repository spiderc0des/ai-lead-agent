/**
 * Environment loading for standalone scripts.
 *
 * Next.js reads `.env.local` automatically; plain `dotenv/config` does not —
 * it only reads `.env`. Scripts importing `dotenv/config` therefore saw none
 * of the values the README tells you to put in `.env.local`.
 *
 * Import this FIRST in every script, before anything that reads process.env.
 */
import { config } from "dotenv";

// Same precedence Next.js uses: .env.local wins, .env fills the gaps.
config({ path: [".env.local", ".env"], quiet: true });

/**
 * The Supabase URL must be the bare project origin. supabase-js appends
 * `/rest/v1`, `/auth/v1` and the rest itself, so a URL that already carries a
 * path produces requests to `/rest/v1/rest/v1/…` that fail in ways that do not
 * mention the real cause.
 */
export function assertSupabaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL is not a valid URL: ${raw}`);
  }

  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL must be the bare project URL with no path.\n` +
        `  got:      ${raw}\n` +
        `  expected: ${url.origin}\n` +
        `Drop the '${url.pathname}' — the client adds those paths itself.`,
    );
  }

  return url.origin;
}

/** Throws a single clear error naming every missing variable. */
export function requireEnv(...names: string[]): void {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    throw new Error(
      `Missing ${missing.join(", ")}.\n` +
        `Copy .env.example to .env.local and fill it in — scripts read .env.local first, then .env.`,
    );
  }
}
