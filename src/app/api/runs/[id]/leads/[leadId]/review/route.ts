import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { recordRunEvent } from "@/lib/run-events";
import { displayName } from "@/lib/display-name";
import { ReviewSchema, isMissingReviewColumns } from "@/lib/review";

export const runtime = "nodejs";

/**
 * Record a person's verdict on a needs_review lead: good or not good, with a
 * note. Only needs_review leads take one — a qualified or rejected lead was
 * already decided, and a verdict on it would read as a second, conflicting
 * decision.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string; leadId: string }> }) {
  try {
    const user = await requireUser();
    const { id, leadId } = await ctx.params;
    const parsed = ReviewSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid review" }, { status: 400 });
    }
    const { decision, note } = parsed.data;

    const db = supabaseAdmin();
    const { data: run } = await db.from("runs").select("id, user_id").eq("id", id).maybeSingle();
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    // The service role bypasses RLS, so ownership is checked here.
    if (run.user_id !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: "Not your run" }, { status: 403 });
    }

    const { data: lead } = await db
      .from("leads")
      .select("id, company_name, company_domain, qualification_status")
      .eq("id", leadId)
      .eq("run_id", id)
      .maybeSingle();
    if (!lead) return NextResponse.json({ error: "Lead not found on this run" }, { status: 404 });
    if (lead.qualification_status !== "needs_review") {
      return NextResponse.json(
        { error: `${lead.company_name} is ${lead.qualification_status.replace(/_/g, " ")}, not waiting for review.` },
        { status: 409 },
      );
    }

    const { error } = await db
      .from("leads")
      .update(
        decision
          ? {
              review_decision: decision,
              review_note: note || null,
              reviewed_by: user.id,
              reviewed_by_name: displayName(user),
              reviewed_at: new Date().toISOString(),
            }
          : { review_decision: null, review_note: null, reviewed_by: null, reviewed_by_name: null, reviewed_at: null },
      )
      .eq("id", leadId);
    if (error) {
      const missing = isMissingReviewColumns(error.message);
      return NextResponse.json(
        { error: missing ? "Apply supabase/migrations/0010_reviews.sql to record reviews." : error.message },
        { status: missing ? 409 : 500 },
      );
    }

    await recordRunEvent(id, run.user_id, "lead_reviewed", user, {
      lead_id: leadId,
      company: lead.company_name,
      domain: lead.company_domain,
      decision,
      note: note || null,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}
