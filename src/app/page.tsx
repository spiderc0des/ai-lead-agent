import Link from "next/link";
import { redirect } from "next/navigation";
import { currentProfile } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { NewRunForm } from "@/components/NewRunForm";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const profile = await currentProfile();
  if (!profile) redirect("/login");

  // Read through the user's own session, so RLS decides what comes back
  // rather than application code remembering to filter.
  const supabase = await supabaseServer();
  const { data: runs } = await supabase
    .from("runs")
    .select("id, objective, status, created_at, total_cost_usd")
    .order("created_at", { ascending: false })
    .limit(25);

  const hasActiveRun = (runs ?? []).some((r) =>
    ["queued", "running"].includes(r.status as string),
  );

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <NewRunForm hasActiveRun={hasActiveRun} />

        <h2 className="mt-10 text-sm font-semibold">Your runs</h2>
        {!runs?.length ? (
          <p className="mt-3 text-sm text-neutral-500">
            No runs yet. Start one above.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-200 rounded-lg border border-neutral-200">
            {runs.map((run) => (
              <li key={run.id}>
                <Link
                  href={`/runs/${run.id}`}
                  className="flex items-start justify-between gap-4 px-4 py-3 hover:bg-neutral-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{run.objective}</p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {new Date(run.created_at as string).toLocaleString()} · $
                      {Number(run.total_cost_usd ?? 0).toFixed(4)}
                    </p>
                  </div>
                  <StatusBadge status={run.status as string} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
