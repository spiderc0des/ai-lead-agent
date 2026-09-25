import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { recordRunEvent } from "@/lib/run-events";
import { displayName } from "@/lib/display-name";

export const runtime = "nodejs";

const Body = z.object({
  processed: z.boolean(),
  note: z.string().trim().max(2000).optional().default(""),
  /** Also put the domain on the team's skip list, so no later run finds it again. */
  suppress: z.boolean().optional().default(false),
});

/**
 * Mark a qualified lead as processed by the team — contacted, handed on, or
 * decided against — with a note. Only qualified leads: they are the list the
 * team works from; needs-review leads get a review verdict instead.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string; leadId: string }> }) {
  try {
    const user = await requireUser();
    const { id, leadId } = await ctx.params;
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    }
    const { processed, note, suppress } = parsed.data;

    const db = supabaseAdmin();
    const { data: run } = await db.from("runs").select("id, user_id").eq("id", id).maybeSingle();
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
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
    if (lead.qualification_status !== "qualified") {
      return NextResponse.json({ error: "Only qualified leads are marked processed." }, { status: 409 });
    }

    const { error } = await db
      .from("leads")
      .update(
        processed
          ? {
              processed_at: new Date().toISOString(),
              processed_by: user.id,
              processed_by_name: displayName(user),
              processed_note: note || null,
            }
          : { processed_at: null, processed_by: null, processed_by_name: null, processed_note: null },
      )
      .eq("id", leadId);
    if (error) {
      const missing = /processed_/.test(error.message);
      return NextResponse.json(
        { error: missing ? "Apply supabase/migrations/0011_suppression.sql to mark leads processed." : error.message },
        { status: missing ? 409 : 500 },
      );
    }

    let suppressed = false;
    if (processed && suppress) {
      const { error: skipError } = await db.from("suppressed_domains").upsert(
        {
          domain: lead.company_domain,
          reason: "contacted",
          note: note ? `Processed: ${note}` : `Processed from a run`,
          added_by: user.id,
          added_by_name: displayName(user),
          source_run_id: id,
        },
        { onConflict: "domain", ignoreDuplicates: true },
      );
      suppressed = !skipError;
    }

    await recordRunEvent(id, run.user_id, "lead_processed", user, {
      lead_id: leadId,
      company: lead.company_name,
      domain: lead.company_domain,
      processed,
      note: note || null,
      suppressed,
    });

    return NextResponse.json({ ok: true, suppressed });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}
