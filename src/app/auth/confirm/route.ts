import { type NextRequest, NextResponse } from "next/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import { publicUrl } from "@/lib/public-origin";

/**
 * Magic-link and invite landing.
 *
 * Supabase can arrive here in three different shapes and which one you get
 * depends on a dashboard setting, so all three are handled:
 *
 *   ?code=...                  PKCE. What @supabase/ssr's browser client asks
 *                              for by default, and what the stock email
 *                              template produces after /auth/v1/verify.
 *   ?token_hash=...&type=...   The template customised to {{ .TokenHash }},
 *                              which is the pattern Supabase documents for
 *                              server-side auth.
 *   ?error=...                 Supabase rejected the link before redirecting —
 *                              usually expired, already used, or a redirect
 *                              URL that is not on the allowlist.
 *
 * Handling only one of these is a silent trap: the email arrives, the link
 * looks right, and the user lands back on /login with no explanation.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const next = searchParams.get("next") ?? "/";
  // App-relative only. "//evil.com" and "/\\evil.com" also start with "/" but
  // a browser treats them as another host, which would make this an open
  // redirect straight after sign-in.
  const safeNext = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";

  // Supabase reports its own failures in the query string.
  const supabaseError =
    searchParams.get("error_description") ?? searchParams.get("error");
  if (supabaseError) {
    return NextResponse.redirect(
      publicUrl(`/login?error=${encodeURIComponent(supabaseError)}`, request),
    );
  }

  const supabase = await supabaseServer();

  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        publicUrl(`/login?error=${encodeURIComponent(error.message)}`, request),
      );
    }
    return NextResponse.redirect(publicUrl(safeNext, request));
  }

  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (error) {
      return NextResponse.redirect(
        publicUrl(`/login?error=${encodeURIComponent(error.message)}`, request),
      );
    }
    return NextResponse.redirect(publicUrl(safeNext, request));
  }

  // Nothing usable in the URL. Most often the email template still points at
  // the implicit flow, which puts the session in the URL fragment where a
  // server route cannot see it.
  return NextResponse.redirect(
    publicUrl("/login?error=link_missing_token", request),
  );
}
