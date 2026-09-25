import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { recordRunEvent } from "@/lib/run-events";
import { generateOutreach, GenerationError } from "@/lib/outreach-generation";

export const runtime = "nodejs";
// One Claude call, plus a retry if the first draft breaks a rule.
export const maxDuration = 300;

const Body = z.object({
  target: z.enum(["all", "emails", "linkedin"]).default("all"),
  instruction: z.string().trim().max(1000, "Keep the instruction under 1,000 characters").optional().default(""),
});

/**
 * Write or rewrite one lead's outreach from the pack page. Drafts are only
 * replaced once the new ones pass every check, so a failed attempt leaves the
 * old drafts in place.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string; leadId: string }> }) {
  try {
    const user = await requireUser();
    const { id, leadId } = await ctx.params;
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    }

    const { data: run } = await supabaseAdmin().from("runs").select("id, user_id, status").eq("id", id).maybeSingle();
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (run.user_id !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: "Not your run" }, { status: 403 });
    }
    if (["queued", "running"].includes(run.status)) {
      return NextResponse.json({ error: "Wait for the run to finish before rewriting its drafts." }, { status: 409 });
    }

    const result = await generateOutreach({
      leadId,
      runId: id,
      target: parsed.data.target,
      instruction: parsed.data.instruction,
      actorId: user.id,
    });

    const { data: lead } = await supabaseAdmin().from("leads").select("company_name, company_domain").eq("id", leadId).single();
    await recordRunEvent(id, run.user_id, "drafts_generated", user, {
      lead_id: leadId,
      company: lead?.company_name,
      domain: lead?.company_domain,
      target: result.target,
      instruction: parsed.data.instruction || null,
      cost_usd: result.costUsd,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    if (err instanceof GenerationError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}
