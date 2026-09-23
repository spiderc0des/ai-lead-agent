import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { RunLimitsSchema } from "@/lib/schemas";
import { budgetStatus, reserveBudget, releaseBudget } from "@/agent/budget";
import { pumpQueue } from "@/agent/queue";
import { recordRunEvent } from "@/lib/run-events";
import { getRunSettings, activeRunsFor } from "@/lib/settings";

export const runtime = "nodejs";

const Body = z.object({
  /** Answers to the clarification questions, in the order they were asked. */
  answers: z.array(z.string()).optional(),
  /** Approve the recorded ICP and go on to discovery. */
  approve: z.boolean().optional(),
});

/** Below this the run could not do anything useful with a new session. */
const MIN_SESSION_BUDGET_USD = 0.1;

/**
 * Resume a run that stopped waiting on a person — the same run, not a new one.
 *
 * The agent session itself is not persisted, so the resume is a fresh session
 * under the same run id. Everything that matters carries over because it lives
 * in the database rather than the session: the ICP, candidates, scraped pages,
 * leads, and the limits, which are enforced against run-wide counts. Money is
 * cumulative too — the new session reserves only what the run has left.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;

    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const db = supabaseAdmin();
    const { data: run } = await db
      .from("runs")
      .select("id, user_id, status, limits, total_cost_usd, clarification_questions")
      .eq("id", id)
      .maybeSingle();

    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (run.user_id !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: "Not your run" }, { status: 403 });
    }
    if (run.status !== "needs_clarification" && run.status !== "awaiting_confirmation") {
      return NextResponse.json(
        { error: `This run is ${String(run.status).replace(/_/g, " ")} — nothing is waiting on you.` },
        { status: 409 },
      );
    }

    // The owner's per-person limit applies to the resumed session too.
    const { maxRunsPerUser } = await getRunSettings();
    if ((await activeRunsFor(run.user_id, id)) >= maxRunsPerUser) {
      return NextResponse.json(
        { error: "The most runs allowed per person are already in progress. Wait for one to finish first." },
        { status: 409 },
      );
    }

    // Validate the reply before touching money.
    let answeredPairs: { question: string; answer: string }[] = [];
    if (run.status === "awaiting_confirmation") {
      if (!parsed.data.approve) {
        return NextResponse.json({ error: "Approve the criteria to continue." }, { status: 400 });
      }
    } else {
      const questions = (run.clarification_questions ?? []) as string[];
      const answers = parsed.data.answers ?? [];
      answeredPairs = questions
        .map((q, i) => ({ question: q, answer: (answers[i] ?? "").trim() }))
        .filter((p) => p.answer);
      if (answeredPairs.length === 0) {
        return NextResponse.json(
          { error: "Answer at least one question so the run has something to go on." },
          { status: 400 },
        );
      }
    }

    // The run keeps its original budget ceiling across sessions: this session
    // gets only what earlier ones left unspent.
    const limits = RunLimitsSchema.parse(run.limits);
    const spent = Number(run.total_cost_usd ?? 0);
    const remaining = Number((limits.max_budget_usd - spent).toFixed(6));
    if (remaining < MIN_SESSION_BUDGET_USD) {
      return NextResponse.json(
        { error: `This run has used $${spent.toFixed(2)} of its $${limits.max_budget_usd.toFixed(2)} budget — too little is left to continue.` },
        { status: 402 },
      );
    }

    const budget = await budgetStatus();
    if (budget.runs_paused) {
      return NextResponse.json({ error: "New runs are paused by an administrator." }, { status: 503 });
    }
    const reservation = await reserveBudget("agent", remaining, id, run.user_id, "run resumed");
    if (!reservation.ok) {
      return NextResponse.json({ error: `Could not reserve budget: ${reservation.reason}` }, { status: 402 });
    }

    // Conditional on the status it was read in, so a double-click cannot
    // resume the run twice and hold two reservations for one session.
    const { data: resumed, error } = await db
      .from("runs")
      .update({
        status: "queued",
        status_reason: null,
        finished_at: null,
        reserved_usd: remaining,
        ...(run.status === "awaiting_confirmation" ? { icp_approved_at: new Date().toISOString() } : {}),
      })
      .eq("id", id)
      .eq("status", run.status)
      .select("id")
      .maybeSingle();

    if (error || !resumed) {
      await releaseBudget("agent", remaining, id, run.user_id, "resume did not apply");
      return NextResponse.json(
        { error: error ? `Could not resume: ${error.message}` : "This run was already resumed." },
        { status: error ? 500 : 409 },
      );
    }

    const actor = { id: user.id, email: user.email };
    if (run.status === "awaiting_confirmation") {
      await recordRunEvent(id, run.user_id, "approved", actor, {});
    } else {
      await recordRunEvent(id, run.user_id, "answered", actor, { answers: answeredPairs });
    }

    void pumpQueue();
    return NextResponse.json({ runId: id }, { status: 202 });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    if (err instanceof z.ZodError) {
      // A stored row that no longer matches the schema is a bug on our side,
      // not something the person can fix — so log the detail and say so.
      console.error("[continue] stored run failed validation:", err.issues);
      return NextResponse.json(
        { error: "This run's saved settings could not be read, so it cannot be resumed. Start a new run instead." },
        { status: 500 },
      );
    }
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
