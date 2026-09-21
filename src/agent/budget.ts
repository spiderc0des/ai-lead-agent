import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { RunLimitsSchema, type RunLimits } from "@/lib/schemas";

/**
 * Two independent layers of spend control.
 *
 * 1. PER-RUN LIMITS — frozen in runs.limits when the run is created. The agent
 *    never gets a writable copy; each tool clamps against the live count read
 *    back from Postgres, not an in-memory counter, so a restart or two
 *    concurrent tool calls cannot overshoot.
 *
 * 2. GLOBAL LEDGER — one shared cap across every user of this app, enforced in
 *    Postgres by reserve/settle/release (0003_budget.sql). Reserve the worst
 *    case before calling a paid API, settle the actual once it reports back.
 */

export type RunContext = {
  runId: string;
  userId: string;
  limits: RunLimits;
  objective: string;
};

export async function loadRunContext(runId: string): Promise<RunContext> {
  const { data, error } = await supabaseAdmin()
    .from("runs")
    .select("id, user_id, limits, objective")
    .eq("id", runId)
    .single();

  if (error || !data) throw new Error(`Run ${runId} not found: ${error?.message ?? "no row"}`);

  return {
    runId: data.id,
    userId: data.user_id,
    limits: RunLimitsSchema.parse(data.limits),
    objective: data.objective,
  };
}

/* ------------------------------------------------------------------ counts */

async function countRows(table: string, runId: string): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId);
  if (error) throw new Error(`Failed counting ${table}: ${error.message}`);
  return count ?? 0;
}

export async function countCandidates(runId: string): Promise<number> {
  return countRows("candidates", runId);
}

export async function countScrapes(runId: string): Promise<number> {
  return countRows("page_sources", runId);
}

export async function countQualifiedLeads(runId: string): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("qualification_status", "qualified");
  if (error) throw new Error(`Failed counting qualified leads: ${error.message}`);
  return count ?? 0;
}

export type RunCounters = {
  candidates: number;
  scrapes: number;
  qualified: number;
  remainingCandidates: number;
  remainingScrapes: number;
  remainingQualified: number;
};

export async function readCounters(ctx: RunContext): Promise<RunCounters> {
  const [candidates, scrapes, qualified] = await Promise.all([
    countCandidates(ctx.runId),
    countScrapes(ctx.runId),
    countQualifiedLeads(ctx.runId),
  ]);

  return {
    candidates,
    scrapes,
    qualified,
    remainingCandidates: Math.max(0, ctx.limits.max_candidates - candidates),
    remainingScrapes: Math.max(0, ctx.limits.max_scrapes - scrapes),
    remainingQualified: Math.max(0, ctx.limits.max_leads - qualified),
  };
}

/* ------------------------------------------------------------ global ledger */

export type BudgetKind = "apify" | "agent";

export type ReserveResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: string };

export async function reserveBudget(
  kind: BudgetKind,
  amountUsd: number,
  runId?: string,
  userId?: string,
  note?: string,
): Promise<ReserveResult> {
  const { data, error } = await supabaseAdmin().rpc("reserve_budget", {
    p_kind: kind,
    p_amount: amountUsd,
    p_run_id: runId ?? null,
    p_user_id: userId ?? null,
    p_note: note ?? null,
  });

  if (error) return { ok: false, reason: `LEDGER_ERROR: ${error.message}` };
  return data as ReserveResult;
}

export async function settleBudget(
  kind: BudgetKind,
  reservedUsd: number,
  actualUsd: number,
  runId?: string,
  userId?: string,
  note?: string,
): Promise<void> {
  const { error } = await supabaseAdmin().rpc("settle_budget", {
    p_kind: kind,
    p_reserved: reservedUsd,
    p_actual: actualUsd,
    p_run_id: runId ?? null,
    p_user_id: userId ?? null,
    p_note: note ?? null,
  });
  if (error) console.error("[budget] settle failed:", error.message);
}

export async function releaseBudget(
  kind: BudgetKind,
  amountUsd: number,
  runId?: string,
  userId?: string,
  note?: string,
): Promise<void> {
  const { error } = await supabaseAdmin().rpc("release_budget", {
    p_kind: kind,
    p_amount: amountUsd,
    p_run_id: runId ?? null,
    p_user_id: userId ?? null,
    p_note: note ?? null,
  });
  if (error) console.error("[budget] release failed:", error.message);
}

export type BudgetStatus = {
  apify_remaining_usd: number;
  apify_cap_usd: number;
  apify_spent_usd: number;
  agent_remaining_usd: number;
  agent_cap_usd: number;
  agent_spent_usd: number;
  runs_paused: boolean;
};

export async function budgetStatus(): Promise<BudgetStatus> {
  const { data, error } = await supabaseAdmin().rpc("budget_status");
  if (error) throw new Error(`Failed reading budget: ${error.message}`);
  return data as BudgetStatus;
}
