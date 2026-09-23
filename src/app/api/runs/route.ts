import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CreateRunSchema, DEFAULT_LIMITS, RunLimitsSchema } from "@/lib/schemas";
import { budgetStatus, reserveBudget, releaseBudget } from "@/agent/budget";
import { pumpQueue } from "@/agent/queue";
import { APIFY_MIN_RUN_CHARGE_USD } from "@/lib/apify";
import { recordRunEvent } from "@/lib/run-events";
import { getRunSettings, activeRunsFor } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Refuse to start a run that could not afford even one discovery call.
 * Apify will not accept a per-run charge cap below its own floor, so the pool
 * has to be able to absorb that ceiling regardless of the real cost.
 */
const MIN_APIFY_HEADROOM_USD = APIFY_MIN_RUN_CHARGE_USD;

export async function POST(request: Request) {
  try {
    const user = await requireUser();

    const parsed = CreateRunSchema.safeParse(await request.json());
    if (!parsed.success) {
      // Show the specific reason: "Invalid request" tells someone with a
      // truncated objective nothing about what to change.
      const first = parsed.error.issues[0]?.message ?? "Invalid request";
      return NextResponse.json(
        { error: first, detail: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const limits = RunLimitsSchema.parse({ ...DEFAULT_LIMITS, ...parsed.data.limits });

    // A per-person cap on active runs, set by an admin: the worker pool is
    // shared, and one person queueing ten runs would starve everyone else.
    const { maxRunsPerUser } = await getRunSettings();
    const active = await activeRunsFor(user.id);
    if (active >= maxRunsPerUser) {
      return NextResponse.json(
        {
          error:
            maxRunsPerUser === 1
              ? "You already have a run in progress. Wait for it to finish or cancel it first."
              : `You already have ${active} runs in progress, the most allowed per person. Wait for one to finish first.`,
        },
        { status: 409 },
      );
    }

    // Budget gates, checked before anything is spent so the user gets a plain
    // message rather than a run that dies halfway through.
    const budget = await budgetStatus();
    if (budget.runs_paused) {
      return NextResponse.json(
        { error: "New runs are paused by an administrator." },
        { status: 503 },
      );
    }
    if (budget.agent_remaining_usd < limits.max_budget_usd) {
      return NextResponse.json(
        {
          error:
            `The shared model budget has $${budget.agent_remaining_usd.toFixed(2)} left, ` +
            `less than this run's $${limits.max_budget_usd.toFixed(2)} cap. ` +
            `Lower the cap or ask an admin to raise the shared limit.`,
        },
        { status: 402 },
      );
    }
    if (budget.apify_remaining_usd < MIN_APIFY_HEADROOM_USD) {
      return NextResponse.json(
        {
          error:
            `The shared Apify discovery budget is exhausted ` +
            `($${budget.apify_remaining_usd.toFixed(4)} left). Company discovery would fail.`,
        },
        { status: 402 },
      );
    }

    // Hold this run's worst-case model spend against the shared cap up front.
    const reservation = await reserveBudget(
      "agent",
      limits.max_budget_usd,
      undefined,
      user.id,
      "run created",
    );
    if (!reservation.ok) {
      return NextResponse.json(
        { error: `Could not reserve budget: ${reservation.reason}` },
        { status: 402 },
      );
    }

    const { data: run, error } = await supabaseAdmin()
      .from("runs")
      .insert({
        user_id: user.id,
        objective: parsed.data.objective.trim(),
        limits,
        status: "queued",
        reserved_usd: limits.max_budget_usd,
      })
      .select("id")
      .single();

    if (error || !run) {
      await releaseBudget("agent", limits.max_budget_usd, undefined, user.id, "run insert failed");
      return NextResponse.json(
        { error: `Could not create run: ${error?.message ?? "unknown"}` },
        { status: 500 },
      );
    }

    await recordRunEvent(run.id, user.id, "created", { id: user.id, email: user.email }, {
      objective: parsed.data.objective.trim(),
      require_icp_confirmation: limits.require_icp_confirmation,
      max_budget_usd: limits.max_budget_usd,
    });

    // Starts immediately if a worker slot is free, otherwise the run waits.
    void pumpQueue();

    return NextResponse.json({ runId: run.id }, { status: 202 });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
