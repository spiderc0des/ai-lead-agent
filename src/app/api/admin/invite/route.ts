import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, authErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const Body = z.object({ email: z.string().email() });

/**
 * Invite someone. Signup is otherwise closed: /login uses
 * shouldCreateUser:false, so an address with no auth user never gets a link.
 * This is the only way in.
 */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
    }

    const email = parsed.data.email.trim().toLowerCase();
    const db = supabaseAdmin();

    await db.from("allowed_emails").upsert(
      { email, invited_by: admin.id, invited_at: new Date().toISOString() },
      { onConflict: "email" },
    );

    const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/auth/confirm`;
    const { error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo });

    if (error) {
      // Re-inviting someone who already exists is not a failure worth surfacing
      // as one; they can just use the normal sign-in link.
      const alreadyExists = /already.*registered|already been registered/i.test(error.message);
      if (!alreadyExists) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({
        ok: true,
        note: `${email} already has an account — they can sign in from /login.`,
      });
    }

    return NextResponse.json({ ok: true, note: `Invite sent to ${email}.` });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
