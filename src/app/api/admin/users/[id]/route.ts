import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, authErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const Body = z
  .object({
    role: z.enum(["member", "admin"]).optional(),
    full_name: z.string().trim().min(1, "A name can't be empty").max(120).optional(),
  })
  .refine((b) => b.role !== undefined || b.full_name !== undefined, { message: "Nothing to change" });

/**
 * Change a person's role or name.
 *
 * An admin cannot demote themselves. It is the one change that can lock
 * everyone out of /admin — if they are the last admin, nobody is left to undo
 * it — and "ask another admin" is a cheap price for making that impossible.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid change" }, { status: 400 });
    }
    const { role, full_name } = parsed.data;

    if (id === admin.id && role === "member") {
      return NextResponse.json(
        { error: "You can't remove your own admin role. Ask another admin to do it." },
        { status: 400 },
      );
    }

    const db = supabaseAdmin();
    const { data: updated, error } = await db
      .from("profiles")
      .update({ ...(role ? { role } : {}), ...(full_name ? { full_name } : {}) })
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) {
      const missing = /full_name/.test(error.message);
      return NextResponse.json(
        { error: missing ? "Apply supabase/migrations/0008_names_roles.sql to store names." : error.message },
        { status: missing ? 409 : 500 },
      );
    }
    if (!updated) return NextResponse.json({ error: "No such user" }, { status: 404 });

    if (full_name) {
      // Log entries written before this person had a name showed their email.
      // Fill those in; entries that already carry a name keep the one they
      // were written with.
      await db.from("run_events").update({ actor_name: full_name }).eq("actor_id", id).is("actor_name", null);
      await db.from("allowed_emails").update({ full_name }).eq("email", updated.email);
    }
    if (role) await db.from("allowed_emails").update({ role }).eq("email", updated.email);

    const who = updated.full_name || updated.email;
    return NextResponse.json({
      ok: true,
      note: role ? `${who} is now ${role === "admin" ? "an admin" : "a member"}.` : `Renamed to ${who}.`,
    });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
