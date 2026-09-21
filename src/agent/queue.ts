import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runAgent, activeRunCount, isRunning } from "@/agent/run-agent";
import { settleBudget } from "@/agent/budget";

/**
 * Run scheduling.
 *
 * Several people share this app and each run spawns a Claude Code subprocess,
 * so runs are queued rather than started on demand. Without this, three users
 * clicking Start at once would put three agent processes in one container.
 *
 * Scope: correct for a SINGLE process. The claim below is atomic against the
 * database, so two calls in this process cannot take the same run, but two
 * container replicas could. Scaling out would need a Postgres advisory lock.
 */

export function maxConcurrentRuns(): number {
  const raw = Number(process.env.MAX_CONCURRENT_RUNS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2;
}

/** A run is presumed dead if it has not touched heartbeat_at in this long. */
const HEARTBEAT_STALE_MS = 3 * 60 * 1000;

let pumping = false;

/**
 * Start as many queued runs as the concurrency budget allows.
 *
 * Safe to call from anywhere: on boot, after an enqueue, and when a run ends.
 * Re-entrant calls are collapsed by the `pumping` flag.
 */
export async function pumpQueue(): Promise<void> {
  if (pumping) return;
  pumping = true;

  try {
    while (activeRunCount() < maxConcurrentRuns()) {
      const claimed = await claimNextRun();
      if (!claimed) break;

      // Deliberately not awaited: runAgent owns the run's whole lifecycle and
      // re-pumps the queue when it finishes.
      void runAgent(claimed)
        .catch((err) => {
          console.error(`[queue] run ${claimed} threw:`, err);
        })
        .finally(() => {
          void pumpQueue();
        });
    }
  } finally {
    pumping = false;
  }
}

/**
 * Take the oldest queued run whose owner has nothing else in flight.
 *
 * The claim is a conditional UPDATE, so if two callers race for the same row
 * the loser gets zero rows back and moves on to the next one.
 */
async function claimNextRun(): Promise<string | null> {
  const { data: queued, error } = await supabaseAdmin()
    .from("runs")
    .select("id, user_id")
    .eq("status", "queued")
    .order("queued_at", { ascending: true })
    .limit(20);

  if (error) {
    console.error("[queue] could not read the queue:", error.message);
    return null;
  }
  if (!queued?.length) return null;

  // One active run per user, so nobody can monopolise the workers.
  const busyUsers = await activeUserIds();

  for (const run of queued) {
    if (busyUsers.has(run.user_id)) continue;
    if (isRunning(run.id)) continue;

    const { data: claimedRow } = await supabaseAdmin()
      .from("runs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", run.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();

    if (claimedRow?.id) return claimedRow.id;
  }

  return null;
}

async function activeUserIds(): Promise<Set<string>> {
  const { data } = await supabaseAdmin()
    .from("runs")
    .select("user_id")
    .eq("status", "running");
  return new Set((data ?? []).map((r) => r.user_id));
}

/** How many runs are ahead of this one, for the waiting-room message. */
export async function queuePosition(runId: string): Promise<number | null> {
  const { data: run } = await supabaseAdmin()
    .from("runs")
    .select("queued_at, status")
    .eq("id", runId)
    .single();

  if (!run || run.status !== "queued") return null;

  const { count } = await supabaseAdmin()
    .from("runs")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued")
    .lt("queued_at", run.queued_at);

  return (count ?? 0) + 1;
}

/**
 * Reclaim runs orphaned by a process restart.
 *
 * A run marked `running` with no live AbortController in this process and a
 * stale heartbeat cannot make progress. Left alone it would sit there forever
 * and hold a per-user slot, so it is failed and its budget reservation
 * released.
 */
export async function sweepOrphanedRuns(): Promise<number> {
  const cutoff = new Date(Date.now() - HEARTBEAT_STALE_MS).toISOString();

  const { data: stale } = await supabaseAdmin()
    .from("runs")
    .select("id, user_id, limits, heartbeat_at, started_at, total_cost_usd")
    .eq("status", "running");

  if (!stale?.length) return 0;

  let reclaimed = 0;
  for (const run of stale) {
    if (isRunning(run.id)) continue;
    const last = run.heartbeat_at ?? run.started_at;
    if (last && last > cutoff) continue;

    const { data: updated } = await supabaseAdmin()
      .from("runs")
      .update({
        status: "failed",
        status_reason:
          "The server restarted while this run was in progress. Partial results are still stored.",
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id)
      .eq("status", "running")
      .select("id")
      .maybeSingle();

    if (updated?.id) {
      reclaimed++;
      const reserved = (run.limits as { max_budget_usd?: number })?.max_budget_usd ?? 0;
      if (reserved > 0) {
        // A crashed run still spent real money. Releasing the whole
        // reservation, as this used to, wrote that spend off entirely and left
        // the shared pool over-reporting what was left. The live estimate the
        // stream keeps is a floor rather than the true figure, but settling a
        // floor is strictly better accounting than settling zero.
        const spentSoFar = Number(run.total_cost_usd ?? 0);
        await settleBudget(
          "agent",
          reserved,
          spentSoFar,
          run.id,
          run.user_id,
          spentSoFar > 0
            ? `orphaned run — settled at last known estimate (a floor, the run never reported final usage)`
            : `orphaned run — no usage was recorded before it died`,
        );
      }
    }
  }

  return reclaimed;
}

let bootstrapped = false;

/**
 * Called once per process from instrumentation.ts: clean up anything the
 * previous process left behind, then start whatever is waiting.
 */
export async function bootstrapQueue(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;

  try {
    const reclaimed = await sweepOrphanedRuns();
    if (reclaimed > 0) console.log(`[queue] reclaimed ${reclaimed} orphaned run(s)`);
    await pumpQueue();
  } catch (err) {
    console.error("[queue] bootstrap failed:", err);
  }
}
