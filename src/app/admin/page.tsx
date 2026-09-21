import Link from "next/link";
import { redirect } from "next/navigation";
import { currentProfile } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AppHeader } from "@/components/AppHeader";
import { AdminPanel } from "@/components/AdminPanel";
import { StatusBadge } from "@/components/StatusBadge";

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

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <h1 className="text-lg font-semibold">Admin</h1>

        <div className="mt-6">{budget && <AdminPanel budget={budget} />}</div>

        <section className="mt-8">
          <h2 className="text-sm font-semibold">All runs</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Owner</th>
                  <th className="px-3 py-2 font-medium">Objective</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {(runs ?? []).map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-neutral-500">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-xs">{emailById.get(r.user_id) ?? "—"}</td>
                    <td className="max-w-md truncate px-3 py-2">
                      <Link href={`/runs/${r.id}`} className="underline underline-offset-4">
                        {r.objective}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      ${Number(r.total_cost_usd ?? 0).toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold">Budget ledger</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Every reserve, settle and release, newest first.
          </p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-200">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-neutral-200">
                {(ledger ?? []).map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs text-neutral-500">
                      {new Date(l.created_at).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-1.5 text-xs font-mono">{l.kind}</td>
                    <td className="px-3 py-1.5 text-xs">{l.phase}</td>
                    <td className="px-3 py-1.5 text-xs tabular-nums">
                      ${Number(l.amount_usd).toFixed(4)}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-neutral-500">{l.note ?? ""}</td>
                  </tr>
                ))}
                {!ledger?.length && (
                  <tr>
                    <td className="px-3 py-3 text-sm text-neutral-500">Nothing spent yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
