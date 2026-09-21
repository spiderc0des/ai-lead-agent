import { type NextRequest, NextResponse } from "next/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Magic-link landing. Supabase sends the user here with a token_hash, which we
 * exchange for a session and then redirect on.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  if (!token_hash || !type) {
    return NextResponse.redirect(new URL("/login?error=invalid_link", request.url));
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash });

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, request.url),
    );
  }

  // Only ever redirect to a path on this origin.
  const safeNext = next.startsWith("/") ? next : "/";
  return NextResponse.redirect(new URL(safeNext, request.url));
}
