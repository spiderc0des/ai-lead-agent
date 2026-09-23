import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { RunLimitsSchema } from "@/lib/schemas";
import { budgetStatus, reserveBudget, releaseBudget } from "@/agent/budget";
import { pumpQueue } from "@/agent/queue";

export const runtime = "nodejs";

const Body = z.object({
  /** Answers to the clarification questions, in the order they were asked. */
  answers: z.array(z.string()).optional(),
  /** Approve the recorded ICP and go straight to discovery. */
  approve: z.boolean().optional(),
});

/**
 * Answer a run that stopped waiting on a person, by starting the next one.
 *
 * Not a resume: the agent session is not persisted, so there is nothing to
 * resume. It is also the better shape — the original run keeps its questions
 * and its unapproved ICP as evidence of what was asked, rather than being
 * mutated into something that no longer shows it. The two are linked by
 * parent_run_id.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;

    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { data: parent } = await supabaseAdmin()
      .from("runs")
      .select("id, user_id, objective, icp, limits, status, clarification_questions")
      .eq("id", id)
      .maybeSingle();

    if (!parent) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (parent.user_id !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: "Not your run" }, { status: 403 });
    }
    if (parent.status !== "needs_clarification" && parent.status !== "awaiting_confirmation") {
      return NextResponse.json(
        { error: `This run is ${parent.status} — there is nothing waiting on you.` },
        { status: 409 },
      );
    }

    // One run at a time per person, as everywhere else.
    const { data: active } = await supabaseAdmin()
      .from("runs")
      .select("id")
      .eq("user_id", user.id)
      .in("status", ["queued", "running"])
      .maybeSingle();
    if (active) {
      return NextResponse.json(
        { error: "You already have a run in progress. Wait for it to finish first." },
        { status: 409 },
      );
    }

    const parentLimits = RunLimitsSchema.parse(parent.limits);
    let objective = parent.objective as string;
    let seedIcp: unknown = null;

    if (parent.status === "awaiting_confirmation") {
      if (!parsed.data.approve) {
        return NextResponse.json({ error: "Approve the criteria to continue." }, { status: 400 });
      }
      // Carry the approved criteria forward so the agent starts at discovery.
      seedIcp = parent.icp;
    } else {
      const answers = (parsed.data.answers ?? []).map((a) => a.trim()).filter(Boolean);
      if (answers.length === 0) {
        return NextResponse.json(
          { error: "Answer at least one question so the objective has something to go on." },
          { status: 400 },
        );
      }
      const questions = (parent.clarification_questions ?? []) as string[];
      // The answers become part of the objective, so what the next run was
      // told is exactly what is stored on it — no hidden second input.
      objective = [
        parent.objective,
        "",
        "Additional detail:",
        ...answers.map((a, i) => (questions[i] ? `- ${questions[i]} ${a}` : `- ${a}`)),
      ].join("\n");
    }

    // The follow-up run keeps the parent's limits but never re-asks for
    // approval of criteria that were just approved.
    const limits = { ...parentLimits, require_icp_confirmation: seedIcp ? false : parentLimits.require_icp_confirmation };

    const budget = await budgetStatus();
    if (budget.runs_paused) {
      return NextResponse.json({ error: "New runs are paused by an administrator." }, { status: 503 });
    }
    if (budget.agent_remaining_usd < limits.max_budget_usd) {
      return NextResponse.json(
        { error: `The shared model budget has $${budget.agent_remaining_usd.toFixed(2)} left, less than this run's cap.` },
        { status: 402 },
      );
    }

    const reservation = await reserveBudget("agent", limits.max_budget_usd, undefined, user.id, "continued run");
    if (!reservation.ok) {
      return NextResponse.json({ error: `Could not reserve budget: ${reservation.reason}` }, { status: 402 });
    }

    const { data: run, error } = await supabaseAdmin()
      .from("runs")
      .insert({
        user_id: user.id,
        objective,
        icp: seedIcp,
        limits,
        status: "queued",
        parent_run_id: parent.id,
      })
      .select("id")
      .single();

    if (error || !run) {
      await releaseBudget("agent", limits.max_budget_usd, undefined, user.id, "continue insert failed");
      return NextResponse.json({ error: `Could not create run: ${error?.message}` }, { status: 500 });
    }

    void pumpQueue();
    return NextResponse.json({ runId: run.id }, { status: 202 });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
