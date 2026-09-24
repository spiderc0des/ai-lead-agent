import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, authErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().trim().toLowerCase().email("A valid email address is required"),
  full_name: z.string().trim().min(1, "Their name is required").max(120),
  role: z.enum(["member", "admin"]).default("member"),
});

function alreadyRegistered(err: { code?: string; message?: string } | null): boolean {
  return Boolean(
    err &&
      (err.code === "email_exists" ||
        err.code === "user_already_exists" ||
        /already (been )?registered/i.test(err.message ?? "")),
  );
}

/**
 * Invite someone. Signup is otherwise closed: /login uses
 * shouldCreateUser:false, so an address with no account never gets a link.
 * This is the only way in.
 *
 * Supabase sends the email, using the "Invite user" template in the
 * dashboard (supabase/email-templates/invite-user.html). That template must
 * link to /auth/confirm with {{ .TokenHash }}: inviteUserByEmail does not
 * support PKCE, so the stock {{ .ConfirmationURL }} lands the person with
 * tokens in a URL fragment no server route can read.
 *
 * The name and role are written to the allowlist BEFORE the invite, because
 * inviting creates the auth user, and the on_auth_user_created trigger reads
 * them from there to build the profile.
 */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid invite" }, { status: 400 });
    }
    const { email, full_name, role } = parsed.data;
    const db = supabaseAdmin();

    const { data: existing } = await db.from("profiles").select("*").eq("email", email).maybeSingle();

    // Someone who has signed in already has access; re-inviting would change
    // nothing, and silently overwriting their role from an invite form would
    // be worse. Roles are changed in the Users list. Checked on the auth user
    // rather than the allowlist, because accounts seeded by script have no
    // allowlist row at all.
    if (existing) {
      const { data: authUser } = await db.auth.admin.getUserById(existing.id);
      if (authUser?.user?.last_sign_in_at) {
        return NextResponse.json(
          { error: `${email} already has an account. Change their name or role in the Users list.` },
          { status: 409 },
        );
      }
    }

    const { error: allowError } = await db.from("allowed_emails").upsert(
      { email, full_name, role, invited_by: admin.id, invited_at: new Date().toISOString() },
      { onConflict: "email" },
    );
    if (allowError) {
      const missing = /full_name|role/.test(allowError.message);
      return NextResponse.json(
        {
          error: missing
            ? "Apply supabase/migrations/0008_names_roles.sql first — invites now carry a name and role."
            : `Could not record the invite: ${allowError.message}`,
        },
        { status: missing ? 409 : 500 },
      );
    }

    const redirectTo = `${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/auth/confirm`;
    const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
      data: { full_name },
      redirectTo,
    });

    if (error && !alreadyRegistered(error)) {
      return NextResponse.json({ error: `Supabase could not send the invite: ${error.message}` }, { status: 502 });
    }

    if (error) {
      // Invited before but never signed in: the account exists, so Supabase
      // refuses a second invite. A sign-in link does the same job, and goes
      // out through the "Magic Link" template.
      const { error: otpError } = await db.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
      });
      if (otpError) {
        return NextResponse.json({ error: `Could not resend: ${otpError.message}` }, { status: 502 });
      }
      if (existing) await db.from("profiles").update({ full_name, role }).eq("id", existing.id);
      return NextResponse.json({ ok: true, note: `${full_name} was already invited — sent them a fresh sign-in link.` });
    }

    // The trigger already applied the name and role; this covers a database
    // where 0008 was applied after the trigger was last replaced.
    if (data?.user) {
      await db.from("profiles").update({ full_name, role }).eq("id", data.user.id);
    }

    return NextResponse.json({
      ok: true,
      note: `Invite sent to ${full_name} (${email})${role === "admin" ? " as an admin" : ""}.`,
    });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
