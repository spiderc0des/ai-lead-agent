import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runAgent, activeRunCount, isRunning, notifyOwner } from "@/agent/run-agent";
import { settleBudget, releaseDanglingApify } from "@/agent/budget";
import { getRunSettings, type RunSettings } from "@/lib/settings";
import { recordRunEvent } from "@/lib/run-events";

/**
 * Run scheduling.
 *
 * Several people share this app and each run spawns a Claude Code subprocess,
 * so runs are queued rather than started on demand. Both limits — total
 * workers and runs per person — are admin settings (see lib/settings.ts). Without this, three users
 * clicking Start at once would put three agent processes in one container.
 *
 * Scope: correct for a SINGLE process. The claim below is atomic against the
 * database, so two calls in this process cannot take the same run, but two
 * container replicas could. Scaling out would need a Postgres advisory lock.
 */



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
  // A web-only instance (see instrumentation.ts) queues runs but never starts
  // them; the deployed worker picks them up.
  if (process.env.QUEUE_WORKER === "off") return;
  if (pumping) return;
  pumping = true;

  try {
    // Read once per pump, so an admin raising the worker count takes effect
    // on the next pump rather than the next deploy.
    const settings = await getRunSettings();
    while (activeRunCount() < settings.maxConcurrentRuns) {
      const claimed = await claimNextRun(settings);
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
async function claimNextRun(settings: RunSettings): Promise<string | null> {
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

  // A per-person cap on RUNNING runs, so nobody can monopolise the workers.
  const running = await runningCountByUser();

  for (const run of queued) {
    if ((running.get(run.user_id) ?? 0) >= settings.maxRunsPerUser) continue;
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

async function runningCountByUser(): Promise<Map<string, number>> {
  const { data } = await supabaseAdmin()
    .from("runs")
    .select("user_id")
    .eq("status", "running");
  const counts = new Map<string, number>();
  for (const r of data ?? []) counts.set(r.user_id, (counts.get(r.user_id) ?? 0) + 1);
  return counts;
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
    .select("id, user_id, limits, heartbeat_at, started_at, created_at, total_cost_usd, reserved_usd, session_baseline_usd")
    .eq("status", "running");

  if (!stale?.length) return 0;

  let reclaimed = 0;
  for (const run of stale) {
    if (isRunning(run.id)) continue;
    // Fall back to created_at: a run with neither a heartbeat nor a start
    // time otherwise reads as infinitely stale and was reclaimed the instant
    // the sweep saw it — which, once the sweep ran every minute, included a
    // run the tool tests had inserted seconds earlier.
    const last = run.heartbeat_at ?? run.started_at ?? run.created_at;
    if (last > cutoff) continue;

    const { data: updated } = await supabaseAdmin()
      .from("runs")
      .update({
        status: "failed",
        status_reason:
          "The server restarted while this run was in progress. Partial results are still stored.",
        finished_at: new Date().toISOString(),
        reserved_usd: 0,
      })
      .eq("id", run.id)
      .eq("status", "running")
      .select("id")
      .maybeSingle();

    if (updated?.id) {
      reclaimed++;
      await recordRunEvent(run.id, run.user_id, "failed", null, {
        reason: "The server restarted while this run was in progress. Partial results are still stored.",
      });
      // Nobody was watching when the process died; the owner hears it here.
      void notifyOwner(run.id, "failed");
      // A discovery call that was mid-flight when the process died reserved
      // Apify budget and never settled it.
      await releaseDanglingApify(run.id, run.user_id);
      // What the crashed SESSION held and spent. A resumed run's earlier
      // sessions were already settled, so only the increment since the last
      // baseline belongs to this one.
      const reserved = Number(run.reserved_usd ?? 0);
      if (reserved > 0) {
        // A crashed run still spent real money. Releasing the whole
        // reservation, as this used to, wrote that spend off entirely and left
        // the shared pool over-reporting what was left. The live estimate the
        // stream keeps is a floor rather than the true figure, but settling a
        // floor is strictly better accounting than settling zero.
        const spentSoFar = Math.max(
          0,
          Number(run.total_cost_usd ?? 0) - Number(run.session_baseline_usd ?? 0),
        );
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

/** How often the sweep re-runs after boot. */
const SWEEP_INTERVAL_MS = 60 * 1000;

async function sweepAndPump(): Promise<void> {
  try {
    const reclaimed = await sweepOrphanedRuns();
    if (reclaimed > 0) console.log(`[queue] reclaimed ${reclaimed} orphaned run(s)`);
    await pumpQueue();
  } catch (err) {
    console.error("[queue] sweep failed:", err);
  }
}

/**
 * Called once per process from instrumentation.ts: clean up anything the
 * previous process left behind, start whatever is waiting — and keep doing
 * both every minute.
 *
 * Sweeping only at boot was a bug. A run killed by a restart still has a fresh
 * heartbeat at the moment the new process boots, so the boot sweep always
 * skips it, and it then sat in `running` — holding its budget reservation and
 * its owner's run slot — until some later restart happened to come along more
 * than three minutes after it died. The periodic sweep reclaims it within
 * about four minutes instead. The staleness threshold stays, because on a
 * rolling deploy the old container can still be running when the new one
 * boots, and its runs are alive.
 */
export async function bootstrapQueue(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;

  await sweepAndPump();
  const timer = setInterval(() => void sweepAndPump(), SWEEP_INTERVAL_MS);
  // Never the reason the process stays up.
  timer.unref?.();
}
