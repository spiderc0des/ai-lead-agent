import { redirect } from "next/navigation";
import { currentProfile } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { emailEnabled } from "@/lib/email";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const profile = await currentProfile();
  if (!profile) redirect("/login");

  const supabase = await supabaseServer();
  const { data: runs } = await supabase.from("runs").select("status, total_cost_usd");

  const mine = runs ?? [];
  const spend = mine.reduce((a, r) => a + Number(r.total_cost_usd ?? 0), 0);
  const byStatus = (s: string) => mine.filter((r) => r.status === s).length;

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        <h1 className="text-lg font-semibold">Profile</h1>

        <section className="card mt-5">
          <dl className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <dt className="w-32 shrink-0" style={{ color: "var(--ink-faint)" }}>Name</dt>
              <dd className="font-medium">
                {profile.full_name || <span style={{ color: "var(--ink-faint)" }}>Not set — an admin can add it</span>}
              </dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="w-32 shrink-0" style={{ color: "var(--ink-faint)" }}>Email</dt>
              <dd className="font-medium">{profile.email}</dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="w-32 shrink-0" style={{ color: "var(--ink-faint)" }}>Role</dt>
              <dd>
                <span className={profile.role === "admin" ? "badge badge-accent" : "badge"}>
                  {profile.role === "admin" ? "Admin" : "Member"}
                </span>
                <span className="hint ml-2">
                  {profile.role === "admin"
                    ? "You can see every user's runs and manage budgets, workers and users."
                    : "You can see and manage your own runs."}
                </span>
              </dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="w-32 shrink-0" style={{ color: "var(--ink-faint)" }}>Notifications</dt>
              <dd>
                {emailEnabled
                  ? "On — you get an email when your criteria are ready to review, when a run needs an answer, and when it finishes."
                  : "Off — no mail credentials are configured on this deployment."}
              </dd>
            </div>
          </dl>
        </section>

        <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Runs", String(mine.length)],
            ["Completed", String(byStatus("completed"))],
            ["Needs review", String(byStatus("needs_review"))],
            ["Your model spend", `$${spend.toFixed(2)}`],
          ].map(([label, value]) => (
            <div key={label} className="card p-3">
              <p className="text-xs" style={{ color: "var(--ink-faint)" }}>{label}</p>
              <p className="mt-1 text-lg font-medium tabular-nums">{value}</p>
            </div>
          ))}
        </section>

        <section className="card mt-5">
          <h2 className="text-sm font-semibold">Sign out</h2>
          <p className="hint">Ends this session on this device.</p>
          <form action="/auth/signout" method="post" className="mt-3">
            <button type="submit" className="btn btn-sm">Sign out</button>
          </form>
        </section>
      </main>
    </>
  );
}
