import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { answersFromEvents, composeObjective } from "@/lib/objective";

/**
 * The effective objective for each run in one query, for pages that list many.
 * `db` may be the service-role client or a user's session client; with the
 * latter, RLS limits it to that user's runs, which is exactly what they may see.
 */
export async function effectiveObjectives(
  db: SupabaseClient,
  runs: { id: string; objective: string }[],
): Promise<Map<string, string>> {
  const out = new Map(runs.map((r) => [r.id, r.objective]));
  if (runs.length === 0) return out;

  const { data } = await db
    .from("run_events")
    .select("run_id, kind, detail, created_at")
    .eq("kind", "answered")
    .in("run_id", runs.map((r) => r.id))
    .order("created_at");

  const byRun = new Map<string, { kind: string; detail: unknown }[]>();
  for (const e of data ?? []) {
    const list = byRun.get(e.run_id as string) ?? [];
    list.push(e);
    byRun.set(e.run_id as string, list);
  }
  for (const r of runs) {
    const events = byRun.get(r.id);
    if (events?.length) out.set(r.id, composeObjective(r.objective, answersFromEvents(events)));
  }
  return out;
}

export async function effectiveObjective(
  db: SupabaseClient,
  run: { id: string; objective: string },
): Promise<string> {
  return (await effectiveObjectives(db, [run])).get(run.id) ?? run.objective;
}
