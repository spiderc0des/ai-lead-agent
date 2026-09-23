import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Capacity settings, adjustable by an admin.
 *
 * Read with select("*") and defaulted, so the app keeps working on a database
 * that has not had 0007_workers.sql applied: the columns are simply absent and
 * the old behaviour — env var for workers, one run per person — stands.
 */
export type RunSettings = {
  /** Runs executing at once across every user in this process. */
  maxConcurrentRuns: number;
  /** Runs one person may have queued or running at once. */
  maxRunsPerUser: number;
};

export const WORKER_CEILING = 8;
export const PER_USER_CEILING = 5;

function envWorkers(): number {
  const raw = Number(process.env.MAX_CONCURRENT_RUNS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2;
}

export async function getRunSettings(): Promise<RunSettings> {
  const { data } = await supabaseAdmin().from("app_budget").select("*").eq("id", "global").maybeSingle();
  const row = (data ?? {}) as { max_concurrent_runs?: number; max_runs_per_user?: number };
  return {
    maxConcurrentRuns: row.max_concurrent_runs ?? envWorkers(),
    maxRunsPerUser: row.max_runs_per_user ?? 1,
  };
}

/** How many of this person's runs count against their limit right now. */
export async function activeRunsFor(userId: string, excludeRunId?: string): Promise<number> {
  let q = supabaseAdmin()
    .from("runs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["queued", "running"]);
  if (excludeRunId) q = q.neq("id", excludeRunId);
  return (await q).count ?? 0;
}
