import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentProfile } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AppHeader } from "@/components/AppHeader";
import { OutreachCard, type Draft } from "@/components/OutreachCard";
import { CopyButton } from "@/components/CopyButton";
import { RegenerateOutreach } from "@/components/RegenerateOutreach";
import type { Icp } from "@/lib/schemas";
import { effectiveObjective } from "@/lib/objective-server";

export const dynamic = "force-dynamic";

/**
 * The outreach sample pack, as a page rather than a download.
 *
 * This is the deliverable a human actually reviews, so it is laid out to be
 * read top to bottom and copied piece by piece: the objective, the criteria
 * the agent derived from it, then each qualified lead with the evidence
 * behind it directly above the copy written from that evidence.
 */
export default async function PackPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await currentProfile();
  if (!profile) redirect("/login");
  const { id } = await params;

  const db = supabaseAdmin();
  const { data: run } = await db
    .from("runs")
    .select("id, user_id, objective, icp, status, status_reason, summary, total_cost_usd, created_at")
    .eq("id", id)
    .maybeSingle();

  if (!run) notFound();
  // This route reads with the service role, so ownership is checked here.
  if (run.user_id !== profile.id && profile.role !== "admin") redirect("/");

  // Qualified leads, then needs-review leads a reviewer marked good: both are
  // worth writing to. "*" so review columns come through once they exist.
  const { data: leadRows } = await db
    .from("leads")
    .select("*")
    .eq("run_id", id)
    .in("qualification_status", ["qualified", "needs_review"])
    .order("company_name");

  const { data: draftRows } = await db
    .from("outreach_drafts")
    .select("id, lead_id, channel, step_number, subject, body, personalization_note, evidence_url")
    .eq("run_id", id);

  const all = leadRows ?? [];
  const leads = [
    ...all.filter((l) => l.qualification_status === "qualified"),
    ...all.filter((l) => l.qualification_status === "needs_review" && l.review_decision === "good"),
  ];
  const approvedCount = leads.length - all.filter((l) => l.qualification_status === "qualified").length;
  const canRewrite = !["queued", "running"].includes(run.status);
  const byLead = new Map<string, Draft[]>();
  for (const d of (draftRows ?? []) as Draft[]) byLead.set(d.lead_id, [...(byLead.get(d.lead_id) ?? []), d]);

  const icp = run.icp as Icp | null;
  const objective = await effectiveObjective(db, run);

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
        <Link href={`/runs/${id}`} className="text-xs no-underline" style={{ color: "var(--ink-faint)" }}>
          ← back to the run
        </Link>

        <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Outreach sample pack</h1>
            <p className="hint">
              {leads.length - approvedCount} qualified
              {approvedCount ? ` + ${approvedCount} approved at review` : ""} ·{" "}
              {new Date(run.created_at).toLocaleDateString()} · $
              {Number(run.total_cost_usd ?? 0).toFixed(4)}
            </p>
          </div>
          <div className="flex gap-2">
            <a className="btn btn-sm" href={`/api/runs/${id}/export?format=md`}>Markdown</a>
            <a className="btn btn-sm" href={`/api/runs/${id}/export?format=xlsx`}>Lead list (.xlsx)</a>
          </div>
        </header>

        <p className="panel panel-info mt-4">
          These are drafts for review. Nothing has been sent, no personal email addresses were
          collected, and no address was checked for deliverability.
        </p>

        <section className="card mt-5">
          <div className="flex items-start justify-between gap-2">
            <h2 className="label mb-0">Qualification objective</h2>
            <CopyButton value={objective} />
          </div>
          <p className="mt-1.5 text-sm">{objective}</p>

          {icp && (
            <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Field label="Target" value={icp.target_company_type} />
              <Field label="Industries" value={icp.industries?.join(", ")} />
              <Field label="Geography" value={icp.geography?.join(", ")} />
              <Field label="Headcount" value={icp.headcount_range} />
              <Field label="Problem" value={icp.business_problem} />
              <div className="sm:col-span-2">
                <dt className="label">From the objective</dt>
                <dd>
                  {icp.user_stated?.length ? (
                    <ul className="list-disc pl-5">{icp.user_stated.map((f) => <li key={f}>{f}</li>)}</ul>
                  ) : (
                    <p style={{ color: "var(--ink-faint)" }}>Nothing explicit — the criteria below were inferred.</p>
                  )}
                </dd>
              </div>
              {icp.assumptions?.length > 0 && (
                <div className="sm:col-span-2">
                  <dt className="label">Assumed by the agent</dt>
                  <dd><ul className="list-disc pl-5" style={{ color: "var(--ink-soft)" }}>
                    {icp.assumptions.map((f) => <li key={f}>{f}</li>)}</ul></dd>
                </div>
              )}
              <div className="sm:col-span-2">
                <dt className="label">Hard filters</dt>
                <dd><ul className="list-disc pl-5">{icp.hard_filters?.map((f) => <li key={f}>{f}</li>)}</ul></dd>
              </div>
              {icp.soft_preferences?.length > 0 && (
                <div className="sm:col-span-2">
                  <dt className="label">Soft preferences</dt>
                  <dd><ul className="list-disc pl-5" style={{ color: "var(--ink-soft)" }}>
                    {icp.soft_preferences.map((f) => <li key={f}>{f}</li>)}</ul></dd>
                </div>
              )}
            </dl>
          )}
        </section>

        {run.summary && (
          <section className="card mt-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="label mb-0">What the agent found</h2>
              <CopyButton value={run.summary} />
            </div>
            <p className="preformatted mt-1.5">{run.summary}</p>
          </section>
        )}

        {leads.length === 0 ? (
          <p className="panel panel-warning mt-5">
            This run produced no qualified leads{run.status_reason ? ` — ${run.status_reason}` : ""}.
            Needs-review leads you mark &quot;reviewed: good&quot; on the run page appear here, ready for outreach.
          </p>
        ) : (
          <div className="mt-6 space-y-8">
            {leads.map((lead, i) => (
              <section key={lead.id}>
                <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <span>
                    {i + 1}. {lead.company_name}{" "}
                    <span className="font-normal" style={{ color: "var(--ink-faint)" }}>{lead.company_domain}</span>
                  </span>
                  {lead.qualification_status === "needs_review" && (
                    <span className="badge badge-success">approved at review</span>
                  )}
                </h2>

                <div className="card mt-2">
                  <h3 className="label">Source context</h3>
                  <p className="text-sm">{lead.source_summary}</p>

                  {lead.qualification_status === "needs_review" && lead.review_note && (
                    <>
                      <h3 className="label mt-3">Reviewer&apos;s note{lead.reviewed_by_name ? ` (${lead.reviewed_by_name})` : ""}</h3>
                      <p className="text-sm">{lead.review_note}</p>
                    </>
                  )}

                  <h3 className="label mt-3">
                    {lead.qualification_status === "qualified" ? "Why it qualified" : "Why it might fit"}
                  </h3>
                  <ul className="list-disc pl-5 text-sm">{lead.fit_reasons?.map((r: string) => <li key={r}>{r}</li>)}</ul>

                  {lead.concerns?.length > 0 && (
                    <>
                      <h3 className="label mt-3">Concerns</h3>
                      <ul className="list-disc pl-5 text-sm" style={{ color: "var(--ink-soft)" }}>
                        {lead.concerns.map((c: string) => <li key={c}>{c}</li>)}
                      </ul>
                    </>
                  )}

                  <h3 className="label mt-3">Evidence</h3>
                  <ul className="text-sm">
                    {lead.source_urls?.map((u: string) => (
                      <li key={u}>
                        <a href={u} target="_blank" rel="noreferrer noopener" style={{ color: "var(--accent)" }}>{u}</a>
                      </li>
                    ))}
                  </ul>
                </div>

                {(byLead.get(lead.id) ?? []).length > 0 && (
                  <div className="mt-2">
                    <OutreachCard
                      companyName={lead.company_name}
                      companyDomain={lead.company_domain}
                      drafts={byLead.get(lead.id) ?? []}
                      rewrite={canRewrite ? { runId: id, leadId: lead.id } : undefined}
                    />
                  </div>
                )}
                {canRewrite && (byLead.get(lead.id) ?? []).length === 0 && (
                  <div className="mt-2">
                    <RegenerateOutreach runId={id} leadId={lead.id} hasDrafts={false} />
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
