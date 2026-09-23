import Link from "next/link";
import { redirect } from "next/navigation";
import { currentProfile } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { RunsList, type RunRow } from "@/components/RunsList";
import { effectiveObjectives } from "@/lib/objective-server";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const profile = await currentProfile();
  if (!profile) redirect("/login");

  // Read through the user's own session, so RLS decides what comes back
  // rather than application code remembering to filter.
  const supabase = await supabaseServer();
  const { data: runs } = await supabase
    .from("runs")
    .select("id, objective, status, created_at, total_cost_usd, limits, parent_run_id")
    .order("created_at", { ascending: false })
    .limit(50);

  // One count query for the lot rather than one per run.
  const { data: qualifiedRows } = await supabase
    .from("leads")
    .select("run_id")
    .eq("qualification_status", "qualified");

  const qualifiedByRun = new Map<string, number>();
  for (const l of qualifiedRows ?? []) {
    qualifiedByRun.set(l.run_id as string, (qualifiedByRun.get(l.run_id as string) ?? 0) + 1);
  }

  const objectives = await effectiveObjectives(
    supabase,
    (runs ?? []).map((r) => ({ id: r.id as string, objective: r.objective as string })),
  );

  const rows: RunRow[] = (runs ?? []).map((r) => ({
    id: r.id as string,
    objective: objectives.get(r.id as string) ?? (r.objective as string),
    status: r.status as string,
    created_at: r.created_at as string,
    total_cost_usd: r.total_cost_usd as number | null,
    limits: r.limits as RunRow["limits"],
    parent_run_id: (r.parent_run_id as string | null) ?? null,
    qualified: qualifiedByRun.get(r.id as string) ?? 0,
  }));

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">Your runs</h1>
          <Link href="/new" className="btn btn-primary btn-sm no-underline">
            New run
          </Link>
        </div>
        <RunsList runs={rows} />
      </main>
    </>
  );
}
