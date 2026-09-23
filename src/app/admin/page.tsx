import Link from "next/link";
import { redirect } from "next/navigation";
import { currentProfile } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AppHeader } from "@/components/AppHeader";
import { Collapsible } from "@/components/Collapsible";
import { effectiveObjectives } from "@/lib/objective-server";
import { AdminPanel } from "@/components/AdminPanel";
import { StatusPill } from "@/components/StatusPill";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const profile = await currentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/");

  const db = supabaseAdmin();

  const [{ data: budget }, { data: runs }, { data: ledger }, { data: people }] =
    await Promise.all([
      db.from("app_budget").select("*").eq("id", "global").single(),
      db
        .from("runs")
        .select("id, user_id, objective, status, total_cost_usd, created_at")
        .order("created_at", { ascending: false })
        .limit(40),
      db
        .from("budget_ledger")
        .select("id, kind, phase, amount_usd, note, created_at")
        .order("created_at", { ascending: false })
        .limit(25),
      db.from("profiles").select("id, email, role"),
    ]);

  const emailById = new Map((people ?? []).map((p) => [p.id, p.email]));
  const objectives = await effectiveObjectives(db, runs ?? []);

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <h1 className="text-lg font-semibold">Admin</h1>

        <div className="mt-6">{budget && <AdminPanel budget={budget} />}</div>

        <div className="mt-6 space-y-4">
        <Collapsible title="All runs" count={runs?.length ?? 0} defaultOpen subtitle="every user">
          <div className="overflow-x-auto">
            <table className="data">
              <thead >
                <tr>
                  <th >When</th>
                  <th >Owner</th>
                  <th >Objective</th>
                  <th >Status</th>
                  <th >Cost</th>
                </tr>
              </thead>
              <tbody >
                {(runs ?? []).map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-xs">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="text-xs">{emailById.get(r.user_id) ?? "—"}</td>
                    <td className="max-w-md truncate">
                      <Link href={`/runs/${r.id}`} style={{ color: "var(--accent)" }}>
                        {objectives.get(r.id) ?? r.objective}
                      </Link>
                    </td>
                    <td >
                      <StatusPill status={r.status} />
                    </td>
                    <td className="text-xs tabular-nums">
                      ${Number(r.total_cost_usd ?? 0).toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Collapsible>

        <Collapsible title="Budget ledger" count={ledger?.length ?? 0} subtitle="every reserve, settle and release, newest first">
          <div className="overflow-x-auto">
            <table className="data">
              <tbody >
                {(ledger ?? []).map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap text-xs">
                      {new Date(l.created_at).toLocaleTimeString()}
                    </td>
                    <td className="font-mono text-xs">{l.kind}</td>
                    <td className="text-xs">{l.phase}</td>
                    <td className="text-xs tabular-nums">
                      ${Number(l.amount_usd).toFixed(4)}
                    </td>
                    <td className="text-xs">{l.note ?? ""}</td>
                  </tr>
                ))}
                {!ledger?.length && (
                  <tr>
                    <td className="text-sm">Nothing spent yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Collapsible>
        </div>
      </main>
    </>
  );
}
