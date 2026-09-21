"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { StatusBadge } from "@/components/StatusBadge";
import type { Icp, RunLimits } from "@/lib/schemas";

type Run = {
  id: string;
  objective: string;
  icp: Icp | null;
  limits: RunLimits;
  status: string;
  status_reason: string | null;
  model: string | null;
  total_cost_usd: number | null;
  num_turns: number | null;
  duration_ms: number | null;
  summary: string | null;
  quality_scorecard: Record<string, string> | null;
  created_at: string;
};

type Lead = {
  id: string;
  company_name: string;
  company_domain: string;
  qualification_status: string;
  confidence: number;
  fit_reasons: string[];
  concerns: string[];
  source_urls: string[];
  source_summary: string | null;
};

type ToolCall = {
  id: string;
  tool_name: string;
  purpose: string | null;
  status: string;
  error_message: string | null;
  duration_ms: number | null;
  result_summary: Record<string, unknown> | null;
  created_at: string;
};

type PageSource = {
  id: string;
  url: string;
  title: string | null;
  scraper: string;
  injection_flags: string[];
  content_chars: number | null;
  content_markdown: string | null;
};

type Draft = {
  id: string;
  lead_id: string;
  channel: string;
  step_number: number;
  subject: string | null;
  body: string;
  personalization_note: string | null;
  evidence_url: string | null;
};

const TERMINAL = ["completed", "needs_review", "failed", "cancelled"];

export function RunView({ runId }: { runId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [run, setRun] = useState<Run | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [sources, setSources] = useState<PageSource[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [candidateCount, setCandidateCount] = useState(0);
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors run.status so the fallback poll can check it without an impure
  // setState updater.
  const statusRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    // Every one of these reads is filtered by RLS, not by application code:
    // the anon key only ever returns this user's rows (or everything, for an
    // admin), so an unauthorised run id simply comes back empty.
    const [runRes, leadRes, toolRes, srcRes, draftRes, candRes] = await Promise.all([
      supabase.from("runs").select("*").eq("id", runId).maybeSingle(),
      supabase.from("leads").select("*").eq("run_id", runId).order("company_name"),
      supabase.from("tool_calls").select("*").eq("run_id", runId).order("created_at"),
      supabase.from("page_sources").select("*").eq("run_id", runId).order("scraped_at"),
      supabase.from("outreach_drafts").select("*").eq("run_id", runId),
      supabase.from("candidates").select("id", { count: "exact", head: true }).eq("run_id", runId),
    ]);

    const nextRun = (runRes.data as Run) ?? null;
    statusRef.current = nextRun?.status ?? null;
    setRun(nextRun);
    setLeads((leadRes.data as Lead[]) ?? []);
    setToolCalls((toolRes.data as ToolCall[]) ?? []);
    setSources((srcRes.data as PageSource[]) ?? []);
    setDrafts((draftRes.data as Draft[]) ?? []);
    setCandidateCount(candRes.count ?? 0);
  }, [supabase, runId]);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(load, 250);
  }, [load]);

  useEffect(() => {
    const channel = supabase.channel(`run:${runId}`);
    for (const table of ["runs", "leads", "tool_calls", "page_sources", "outreach_drafts", "candidates"]) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: table === "runs" ? `id=eq.${runId}` : `run_id=eq.${runId}`,
        },
        scheduleRefetch,
      );
    }
    // The first load runs once the subscription is live, not before it. Loading
    // first would leave a gap: any change landing between the fetch and the
    // subscription would be missed until the fallback poll.
    channel.subscribe((status) => {
      // Load on success, and also on failure — a broken Realtime connection
      // must degrade to a readable page, not an indefinite spinner.
      if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        void load();
      }
    });

    // Realtime can still drop a message on a flaky connection; a slow poll
    // while the run is live means the view converges regardless.
    const poll = setInterval(() => {
      const status = statusRef.current;
      if (status === null || !TERMINAL.includes(status)) void load();
    }, 10_000);

    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [supabase, runId, load, scheduleRefetch]);

  async function cancel() {
    setCancelling(true);
    await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
    setCancelling(false);
    void load();
  }

  if (!run) {
    return <p className="text-sm text-neutral-500">Loading run…</p>;
  }

  const qualified = leads.filter((l) => l.qualification_status === "qualified");
  const live = !TERMINAL.includes(run.status);
  const flaggedSources = sources.filter((s) => s.injection_flags?.length);

  return (
    <div className="space-y-8">
      {/* -------------------------------------------------- header --- */}
      <section>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={run.status} />
          {live && <span className="text-xs text-neutral-500">updating live</span>}
          {live && (
            <button
              onClick={cancel}
              disabled={cancelling}
              className="rounded border border-neutral-300 px-2 py-0.5 text-xs disabled:opacity-50"
            >
              {cancelling ? "Cancelling…" : "Cancel run"}
            </button>
          )}
          {!live && qualified.length > 0 && (
            <>
              <a
                href={`/api/runs/${runId}/export?format=md`}
                className="text-xs underline underline-offset-4"
              >
                outreach sample pack
              </a>
              <a
                href={`/api/runs/${runId}/export?format=csv`}
                className="text-xs underline underline-offset-4"
              >
                lead list CSV
              </a>
            </>
          )}
        </div>

        {run.status_reason && (
          <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {run.status_reason}
          </p>
        )}
      </section>

      {/* ------------------------------------------ objective vs ICP --- */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Qualification objective
          </h2>
          <p className="mt-2 text-sm">{run.objective}</p>
        </div>

        <div className="rounded-lg border border-neutral-200 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Refined ICP criteria
          </h2>
          {!run.icp ? (
            <p className="mt-2 text-sm text-neutral-500">
              Not set yet — the agent records this before it searches.
            </p>
          ) : (
            <dl className="mt-2 space-y-1.5 text-sm">
              <Row label="Type" value={run.icp.target_company_type} />
              <Row label="Industries" value={run.icp.industries?.join(", ")} />
              <Row label="Geography" value={run.icp.geography?.join(", ")} />
              <Row label="Headcount" value={run.icp.headcount_range} />
              <Row label="Persona" value={run.icp.buyer_persona} />
              <Row label="Problem" value={run.icp.business_problem} />
              <div>
                <dt className="text-xs text-neutral-500">Hard filters</dt>
                <dd>
                  <ul className="mt-0.5 list-disc pl-5">
                    {run.icp.hard_filters?.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                </dd>
              </div>
              {run.icp.soft_preferences?.length > 0 && (
                <div>
                  <dt className="text-xs text-neutral-500">Soft preferences</dt>
                  <dd>
                    <ul className="mt-0.5 list-disc pl-5 text-neutral-600">
                      {run.icp.soft_preferences.map((f) => <li key={f}>{f}</li>)}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>
      </section>

      {/* ------------------------------------------------- counters --- */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Meter label="Candidates" used={candidateCount} cap={run.limits.max_candidates} />
        <Meter label="Scrapes" used={sources.length} cap={run.limits.max_scrapes} />
        <Meter label="Qualified" used={qualified.length} cap={run.limits.max_leads} />
        <Meter
          label="Turns"
          used={run.num_turns ?? 0}
          cap={run.limits.max_turns}
          note={live ? "counted live; corrected when the run ends" : undefined}
        />
        <Meter
          label="Model spend"
          used={Number(run.total_cost_usd ?? 0)}
          cap={run.limits.max_budget_usd}
          money
          provisional={live}
          note={
            live
              ? "a floor — output tokens are only counted at the end"
              : undefined
          }
        />
        <div className="rounded-lg border border-neutral-200 p-3">
          <p className="text-xs text-neutral-500">Injection attempts</p>
          <p className="mt-1 text-lg font-medium">{flaggedSources.length}</p>
          <p className="text-xs text-neutral-500">
            {flaggedSources.length ? "flagged and ignored" : "none seen"}
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------- leads --- */}
      <section>
        <h2 className="text-sm font-semibold">
          Leads <span className="font-normal text-neutral-500">({leads.length} evaluated)</span>
        </h2>
        {!leads.length ? (
          <p className="mt-2 text-sm text-neutral-500">No qualification decisions yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Conf.</th>
                  <th className="px-3 py-2 font-medium">Fit reasons</th>
                  <th className="px-3 py-2 font-medium">Concerns</th>
                  <th className="px-3 py-2 font-medium">Src</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {leads.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => setOpenLead(openLead === lead.id ? null : lead.id)}
                    className="cursor-pointer align-top hover:bg-neutral-50"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium">{lead.company_name}</div>
                      <div className="text-xs text-neutral-500">{lead.company_domain}</div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={lead.qualification_status} />
                    </td>
                    <td className="px-3 py-2 tabular-nums">{lead.confidence?.toFixed(2)}</td>
                    <td className="px-3 py-2 text-xs text-neutral-700">
                      {lead.fit_reasons?.slice(0, 2).join("; ")}
                      {lead.fit_reasons?.length > 2 && ` +${lead.fit_reasons.length - 2}`}
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-700">
                      {lead.concerns?.slice(0, 2).join("; ") || "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{lead.source_urls?.length ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {openLead && (
          <LeadDetail
            lead={leads.find((l) => l.id === openLead)!}
            drafts={drafts.filter((d) => d.lead_id === openLead)}
            sources={sources}
            onClose={() => setOpenLead(null)}
          />
        )}
      </section>

      {/* ----------------------------------------------- tool calls --- */}
      <section>
        <h2 className="text-sm font-semibold">
          Tool calls <span className="font-normal text-neutral-500">({toolCalls.length})</span>
        </h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Tool</th>
                <th className="px-3 py-2 font-medium">Purpose</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">ms</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {toolCalls.map((tc) => (
                <tr key={tc.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-neutral-500">
                    {new Date(tc.created_at).toLocaleTimeString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{tc.tool_name}</td>
                  <td className="px-3 py-2 text-xs">
                    {tc.purpose ?? "—"}
                    {tc.error_message && (
                      <div className="mt-1 text-xs text-red-700">{tc.error_message}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={tc.status} />
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums text-neutral-500">
                    {tc.duration_ms ?? "—"}
                  </td>
                </tr>
              ))}
              {!toolCalls.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-sm text-neutral-500">
                    No tool calls yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* -------------------------------------------- page sources --- */}
      <section>
        <h2 className="text-sm font-semibold">
          Scraped sources <span className="font-normal text-neutral-500">({sources.length})</span>
        </h2>
        <ul className="mt-3 space-y-2">
          {sources.map((s) => (
            <li key={s.id} className="rounded-lg border border-neutral-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="truncate text-sm underline underline-offset-4"
                >
                  {s.url}
                </a>
                <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600">
                  {s.scraper}
                </span>
                {s.injection_flags?.length > 0 && (
                  <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-xs text-red-800">
                    injection: {s.injection_flags.join(", ")}
                  </span>
                )}
              </div>
              {s.injection_flags?.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-neutral-600">
                    show what the agent actually received
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 text-xs">
                    {s.content_markdown}
                  </pre>
                </details>
              )}
            </li>
          ))}
          {!sources.length && <li className="text-sm text-neutral-500">Nothing scraped yet.</li>}
        </ul>
      </section>

      {/* ---------------------------------------------- scorecard --- */}
      {run.quality_scorecard && (
        <section className="rounded-lg border border-neutral-200 p-4">
          <h2 className="text-sm font-semibold">Quality scorecard</h2>
          {run.summary && <p className="mt-2 text-sm">{run.summary}</p>}
          <dl className="mt-3 space-y-1.5 text-sm">
            {Object.entries(run.quality_scorecard)
              .filter(([k]) => k !== "summary")
              .map(([k, v]) => (
                <Row key={k} label={k.replace(/_/g, " ")} value={v} />
              ))}
          </dl>
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-xs capitalize text-neutral-500">{label}</dt>
      <dd className="flex-1">{value}</dd>
    </div>
  );
}

function Meter({
  label,
  used,
  cap,
  money,
  /** While a run is live these are running estimates, not settled figures. */
  provisional,
  note,
}: {
  label: string;
  used: number;
  cap: number;
  money?: boolean;
  provisional?: boolean;
  note?: string;
}) {
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  const fmt = (n: number) => (money ? `$${n.toFixed(2)}` : String(n));
  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-lg font-medium tabular-nums">
        {provisional && <span className="text-neutral-400">≥ </span>}
        {fmt(used)}
        <span className="text-sm font-normal text-neutral-400"> / {fmt(cap)}</span>
      </p>
      <div className="mt-2 h-1 w-full rounded bg-neutral-100">
        <div
          className={`h-1 rounded ${pct >= 100 ? "bg-amber-500" : "bg-neutral-900"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {note && <p className="mt-1.5 text-xs leading-snug text-neutral-500">{note}</p>}
    </div>
  );
}

function LeadDetail({
  lead,
  drafts,
  sources,
  onClose,
}: {
  lead: Lead;
  drafts: Draft[];
  sources: PageSource[];
  onClose: () => void;
}) {
  const emails = drafts.filter((d) => d.channel === "email").sort((a, b) => a.step_number - b.step_number);
  const linkedin = drafts.find((d) => d.channel === "linkedin");
  const leadSources = sources.filter((s) => lead.source_urls?.includes(s.url));

  return (
    <div className="mt-4 rounded-lg border border-neutral-300 bg-neutral-50 p-4">
      <div className="flex items-start justify-between">
        <h3 className="text-sm font-semibold">
          {lead.company_name} — {lead.company_domain}
        </h3>
        <button onClick={onClose} className="text-xs text-neutral-500 underline underline-offset-4">
          close
        </button>
      </div>

      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Source context
          </h4>
          <p className="mt-1 text-sm">{lead.source_summary ?? "—"}</p>

          <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Sources
          </h4>
          <ul className="mt-1 space-y-0.5 text-sm">
            {lead.source_urls?.map((u) => {
              const src = leadSources.find((s) => s.url === u);
              return (
                <li key={u}>
                  <a href={u} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
                    {u}
                  </a>
                  {src?.injection_flags?.length ? (
                    <span className="ml-2 text-xs text-red-700">
                      (injection attempt flagged)
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Why it fits
          </h4>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {lead.fit_reasons?.map((r) => <li key={r}>{r}</li>)}
          </ul>

          {lead.concerns?.length > 0 && (
            <>
              <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Concerns
              </h4>
              <ul className="mt-1 list-disc pl-5 text-sm text-neutral-700">
                {lead.concerns.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </>
          )}
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Cold email sequence
          </h4>
          {!emails.length ? (
            <p className="mt-1 text-sm text-neutral-500">Not drafted yet.</p>
          ) : (
            <ol className="mt-1 space-y-3">
              {emails.map((e) => (
                <li key={e.id} className="rounded border border-neutral-200 bg-white p-3">
                  <p className="text-xs text-neutral-500">Step {e.step_number}</p>
                  <p className="text-sm font-medium">{e.subject}</p>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-sm">{e.body}</pre>
                  <p className="mt-2 text-xs text-neutral-500">
                    {e.personalization_note}
                    {e.evidence_url && (
                      <>
                        {" · "}
                        <a href={e.evidence_url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
                          evidence
                        </a>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ol>
          )}

          {linkedin && (
            <>
              <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                LinkedIn message
              </h4>
              <pre className="mt-1 whitespace-pre-wrap rounded border border-neutral-200 bg-white p-3 font-sans text-sm">
                {linkedin.body}
              </pre>
            </>
          )}

          <p className="mt-3 text-xs text-neutral-500">
            Drafts only. Nothing here has been sent, and no email addresses were collected.
          </p>
        </div>
      </div>
    </div>
  );
}
