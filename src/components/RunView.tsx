"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { StatusPill } from "@/components/StatusPill";
import { Collapsible } from "@/components/Collapsible";
import { CopyButton } from "@/components/CopyButton";
import { RunActions } from "@/components/RunActions";
import { type Draft } from "@/components/OutreachCard";
import { LeadList } from "@/components/LeadList";
import { ReviewPanel, type ReviewState } from "@/components/ReviewPanel";
import type { ProcessedState } from "@/components/ProcessedPanel";
import { REVIEW_LABEL } from "@/lib/review";
import { RunResponse } from "@/components/RunResponse";
import { RunLog, type RunEvent } from "@/components/RunLog";
import { answersFromEvents, composeObjective } from "@/lib/objective";
import type { Icp, RunLimits } from "@/lib/schemas";

type Run = {
  id: string; objective: string; icp: Icp | null; limits: RunLimits;
  status: string; status_reason: string | null; model: string | null;
  total_cost_usd: number | null; num_turns: number | null; duration_ms: number | null;
  summary: string | null; quality_scorecard: Record<string, string> | null; created_at: string;
  clarification_questions: string[] | null;
  parent_run_id: string | null;
} & ReviewState;
type Lead = {
  id: string; company_name: string; company_domain: string;
  qualification_status: string; confidence: number;
  fit_reasons: string[]; concerns: string[]; source_urls: string[]; source_summary: string | null;
} & ReviewState & ProcessedState;
type ToolCall = {
  id: string; tool_name: string; purpose: string | null; status: string;
  error_message: string | null; duration_ms: number | null; created_at: string;
};
type PageSource = {
  id: string; url: string; title: string | null; scraper: string;
  injection_flags: string[]; content_chars: number | null; content_markdown: string | null;
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
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [logOpen, setLogOpen] = useState(false);

  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    // Every read is filtered by RLS, not by application code: the anon key
    // returns this user's rows only, so an unauthorised id comes back empty.
    const [r, l, t, s, d, c, ev] = await Promise.all([
      supabase.from("runs").select("*").eq("id", runId).maybeSingle(),
      supabase.from("leads").select("*").eq("run_id", runId).order("confidence", { ascending: false }),
      supabase.from("tool_calls").select("*").eq("run_id", runId).order("created_at"),
      supabase.from("page_sources").select("*").eq("run_id", runId).order("scraped_at"),
      supabase.from("outreach_drafts").select("*").eq("run_id", runId),
      supabase.from("candidates").select("id", { count: "exact", head: true }).eq("run_id", runId),
      supabase.from("run_events").select("*").eq("run_id", runId).order("created_at"),
    ]);
    const nextRun = (r.data as Run) ?? null;
    statusRef.current = nextRun?.status ?? null;
    setRun(nextRun);
    setLeads((l.data as Lead[]) ?? []);
    setToolCalls((t.data as ToolCall[]) ?? []);
    setSources((s.data as PageSource[]) ?? []);
    setDrafts((d.data as Draft[]) ?? []);
    setCandidateCount(c.count ?? 0);
    setEvents((ev.data as RunEvent[]) ?? []);
  }, [supabase, runId]);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(load, 250);
  }, [load]);

  useEffect(() => {
    const channel = supabase.channel(`run:${runId}`);
    for (const table of ["runs", "leads", "tool_calls", "page_sources", "outreach_drafts", "candidates", "run_events"]) {
      channel.on("postgres_changes", {
        event: "*", schema: "public", table,
        filter: table === "runs" ? `id=eq.${runId}` : `run_id=eq.${runId}`,
      }, scheduleRefetch);
    }
    // Loading from the subscribe callback closes the gap where a change
    // landing between the fetch and the subscription would be missed. A
    // failure still loads, so a broken socket degrades to a readable page
    // rather than an indefinite spinner.
    channel.subscribe((st) => {
      if (st === "SUBSCRIBED" || st === "CHANNEL_ERROR" || st === "TIMED_OUT") void load();
    });

    const poll = setInterval(() => {
      const st = statusRef.current;
      if (st === null || !TERMINAL.includes(st)) void load();
    }, 10_000);

    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [supabase, runId, load, scheduleRefetch]);

  if (!run) return <p className="text-sm" style={{ color: "var(--ink-faint)" }}>Loading run…</p>;

  const qualified = leads.filter((l) => l.qualification_status === "qualified");
  // The answers replace the original once given; the original lives in the log.
  const objective = composeObjective(run.objective, answersFromEvents(events));
  const refined = objective !== run.objective;
  const live = !TERMINAL.includes(run.status);
  const flagged = sources.filter((s) => s.injection_flags?.length);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status={run.status} />
        {run.review_decision && (
          <span className={run.review_decision === "good" ? "badge badge-success" : "badge badge-danger"}>
            {REVIEW_LABEL[run.review_decision]}
          </span>
        )}
        {live && (
          <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ink-faint)" }}>
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "var(--accent)" }} />
            updating live
          </span>
        )}
        <span className="text-xs" style={{ color: "var(--ink-faint)" }}>
          {new Date(run.created_at).toLocaleString()}
        </span>
      </div>

      <RunActions
        runId={runId}
        objective={objective}
        live={live || run.status === "needs_clarification" || run.status === "awaiting_confirmation"}
        hasQualified={qualified.length > 0 || leads.some((l) => l.qualification_status === "needs_review" && l.review_decision === "good")}
        hasLeadList={leads.some((l) => l.qualification_status === "qualified" || l.qualification_status === "needs_review")}
        logOpen={logOpen}
        onToggleLog={() => setLogOpen((o) => !o)}
        logCount={events.length}
        resume={
          // Interrupted runs with room left can be picked back up. The server
          // re-checks all of this; the button only avoids offering a dead end.
          (run.status === "failed" || run.status === "cancelled") &&
          run.limits.max_budget_usd - Number(run.total_cost_usd ?? 0) >= 0.1 &&
          run.limits.max_turns - (run.num_turns ?? 0) >= 5
            ? {
                budgetLeft: run.limits.max_budget_usd - Number(run.total_cost_usd ?? 0),
                turnsLeft: run.limits.max_turns - (run.num_turns ?? 0),
                found: `${candidateCount} candidates, ${sources.length} pages, ${leads.length} leads`,
              }
            : undefined
        }
      />

      {logOpen && <RunLog objective={run.objective} events={events} />}

      {/* One panel. The reason and the questions were two, which said the same
          thing twice before offering anything to do about it. */}
      {run.status === "needs_clarification" && run.clarification_questions?.length ? (
        <RunResponse runId={runId} mode="clarify" questions={run.clarification_questions} />
      ) : run.status === "awaiting_confirmation" ? (
        <RunResponse key={objective} runId={runId} mode="confirm" questions={[]} objective={objective} />
      ) : run.status_reason ? (
        <p className="panel panel-warning">{run.status_reason}</p>
      ) : null}

      {run.status === "needs_review" && (
        <ReviewPanel
          key={`${run.review_decision ?? ""}:${run.reviewed_at ?? ""}`}
          endpoint={`/api/runs/${runId}/review`}
          current={run}
          subject="this run"
          goodHint="the list is usable as it stands, after checking the reason above."
          notGoodHint="it isn't usable; re-run with a better objective or limits."
          onSaved={() => void load()}
        />
      )}

      {run.parent_run_id && (
        <p className="hint">
          Continued from{" "}
          <a href={`/runs/${run.parent_run_id}`} style={{ color: "var(--accent)" }}>
            an earlier run
          </a>
          .
        </p>
      )}

      {/* ------------------------------------------- objective vs ICP ---- */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <h2 className="label">Qualification objective</h2>
          <p className="text-sm">{objective}</p>
          {refined && (
            <p className="hint">
              From your answers.{" "}
              <button type="button" className="underline underline-offset-2" onClick={() => setLogOpen(true)}>
                Original wording is in the log.
              </button>
            </p>
          )}
        </div>
        <div className="card">
          <h2 className="label">Refined ICP criteria</h2>
          {!run.icp ? (
            <p className="text-sm" style={{ color: "var(--ink-faint)" }}>
              Not set yet — the agent records this before it searches.
            </p>
          ) : (
            <dl className="space-y-1.5 text-sm">
              <Row label="Type" value={run.icp.target_company_type} />
              <Row label="Industries" value={run.icp.industries?.join(", ")} />
              <Row label="Geography" value={run.icp.geography?.join(", ")} />
              <Row label="Headcount" value={run.icp.headcount_range} />
              <Row label="Persona" value={run.icp.buyer_persona} />
              <Row label="Problem" value={run.icp.business_problem} />

              {/* Provenance first: which of these the person actually asked
                  for, and which the agent supplied. Without the split an
                  inferred constraint is indistinguishable from a requested
                  one. */}
              <IcpList
                label="From your objective"
                items={run.icp.user_stated}
                empty="Nothing explicit — everything below was inferred."
              />
              <IcpList label="Assumed by the agent" items={run.icp.assumptions} muted />
              <IcpList label="Hard filters" items={run.icp.hard_filters} defaultOpen />
              <IcpList label="Soft preferences" items={run.icp.soft_preferences} muted />
              <IcpList label="Disqualifiers" items={run.icp.disqualifiers} muted />
            </dl>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------ meters --- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Meter label="Candidates" used={candidateCount} cap={run.limits.max_candidates} />
        <Meter label="Scrapes" used={sources.length} cap={run.limits.max_scrapes} />
        <Meter label="Qualified" used={qualified.length} cap={run.limits.max_leads} />
        <Meter label="Turns" used={run.num_turns ?? 0} cap={run.limits.max_turns}
               note={live ? "counted live; corrected at the end" : undefined} />
        <Meter label="Model spend" used={Number(run.total_cost_usd ?? 0)} cap={run.limits.max_budget_usd}
               money provisional={live} note={live ? "a floor — output counted at the end" : undefined} />
        <div className="card p-3">
          <p className="text-xs" style={{ color: "var(--ink-faint)" }}>Injection attempts</p>
          <p className="mt-1 text-lg font-medium">{flagged.length}</p>
          <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
            {flagged.length ? "flagged and ignored" : "none seen"}
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------- leads --- */}
      <Collapsible
        title="Qualification results"
        count={leads.length}
        defaultOpen
        subtitle={
          leads.length
            ? `${qualified.length} qualified · rejections are part of the deliverable`
            : "nothing evaluated yet"
        }
      >
        <LeadList runId={runId} leads={leads} drafts={drafts} sources={sources} onReviewed={() => void load()} />
      </Collapsible>

      {/* ------------------------------------------- scraped sources ----- */}
      <Collapsible title="Scraped sources" count={sources.length}
                   tone={flagged.length ? "warning" : undefined}
                   subtitle={flagged.length ? `${flagged.length} attempted prompt injection` : undefined}>
        <ul className="space-y-2">
          {sources.map((s) => (
            <li key={s.id} className="rounded-[var(--radius)] border p-3" style={{ borderColor: "var(--rule)" }}>
              <div className="flex flex-wrap items-center gap-2">
                <a href={s.url} target="_blank" rel="noreferrer noopener" className="truncate text-sm"
                   style={{ color: "var(--accent)" }}>{s.url}</a>
                <span className="chip">{s.scraper}</span>
                {s.injection_flags?.length > 0 && (
                  <span className="badge badge-danger">injection: {s.injection_flags.join(", ")}</span>
                )}
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs" style={{ color: "var(--ink-soft)" }}>
                  show what the agent actually received
                </summary>
                <pre className="preformatted mt-2 max-h-72 overflow-auto rounded p-2"
                     style={{ background: "var(--paper)" }}>{s.content_markdown}</pre>
              </details>
            </li>
          ))}
          {!sources.length && <li className="text-sm" style={{ color: "var(--ink-faint)" }}>Nothing scraped yet.</li>}
        </ul>
      </Collapsible>

      {/* ------------------------------------------------- tool calls ---- */}
      <Collapsible title="Tool calls" count={toolCalls.length} subtitle="the agent's audit trail">
        <div className="overflow-x-auto">
          <table className="data">
            <thead><tr><th>Time</th><th>Tool</th><th>Purpose</th><th>Status</th><th>ms</th></tr></thead>
            <tbody>
              {toolCalls.map((tc) => (
                <tr key={tc.id}>
                  <td className="whitespace-nowrap text-xs" style={{ color: "var(--ink-faint)" }}>
                    {new Date(tc.created_at).toLocaleTimeString()}
                  </td>
                  <td className="font-mono text-xs">{tc.tool_name}</td>
                  <td className="text-xs">
                    {tc.purpose ?? "—"}
                    {tc.error_message && (
                      <div className="mt-1" style={{ color: "var(--danger)" }}>{tc.error_message}</div>
                    )}
                  </td>
                  <td><StatusPill status={tc.status} /></td>
                  <td className="text-xs tabular-nums" style={{ color: "var(--ink-faint)" }}>{tc.duration_ms ?? "—"}</td>
                </tr>
              ))}
              {!toolCalls.length && <tr><td colSpan={5} style={{ color: "var(--ink-faint)" }}>No tool calls yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Collapsible>

      {/* -------------------------------------------- the scorecard ------ */}
      {run.quality_scorecard && (
        <Collapsible title="Quality scorecard" subtitle="the agent's self-assessment, re-checked by the server"
          actions={<CopyButton value={run.summary ?? ""} label="Copy summary" />}>
          {run.summary && <p className="preformatted mb-3">{run.summary}</p>}
          <dl className="space-y-1.5 text-sm">
            {Object.entries(run.quality_scorecard)
              .filter(([k]) => k !== "summary")
              .map(([k, v]) => <Row key={k} label={k.replace(/_/g, " ")} value={v} />)}
          </dl>
        </Collapsible>
      )}
    </div>
  );
}

/**
 * One list inside the ICP, folded by default.
 *
 * Six of these open at once is most of a screen of bullets that are read
 * carefully once and skimmed thereafter, so each states its own length and
 * opens on demand. `defaultOpen` is for the one that answers "did it invent
 * these criteria" — hard filters.
 */
function IcpList({
  label,
  items,
  muted,
  empty,
  defaultOpen,
}: {
  label: string;
  items?: string[] | null;
  muted?: boolean;
  empty?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  if (!items?.length && !empty) return null;

  return (
    <div>
      <dt>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-1.5 text-left"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor"
               strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
               style={{ color: "var(--ink-faint)", transform: open ? "rotate(90deg)" : "none", transition: "transform .12s" }}>
            <path d="M6 3l5 5-5 5" />
          </svg>
          <span className="label mb-0">{label}</span>
          {items?.length ? (
            <span className="text-xs" style={{ color: "var(--ink-faint)" }}>({items.length})</span>
          ) : null}
        </button>
      </dt>
      {open && (
        <dd className="mt-1">
          {items?.length ? (
            <ul className="list-disc pl-6" style={muted ? { color: "var(--ink-soft)" } : undefined}>
              {items.map((f) => <li key={f}>{f}</li>)}
            </ul>
          ) : (
            <p className="pl-6" style={{ color: "var(--ink-faint)" }}>{empty}</p>
          )}
        </dd>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-xs capitalize" style={{ color: "var(--ink-faint)" }}>{label}</dt>
      <dd className="flex-1">{value}</dd>
    </div>
  );
}

function Meter({ label, used, cap, money, provisional, note }: {
  label: string; used: number; cap: number; money?: boolean; provisional?: boolean; note?: string;
}) {
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  const fmt = (n: number) => (money ? `$${n.toFixed(2)}` : String(n));
  return (
    <div className="card p-3">
      <p className="text-xs" style={{ color: "var(--ink-faint)" }}>{label}</p>
      <p className="mt-1 text-lg font-medium tabular-nums">
        {provisional && <span style={{ color: "var(--ink-faint)" }}>≥ </span>}
        {fmt(used)}
        <span className="text-sm font-normal" style={{ color: "var(--ink-faint)" }}> / {fmt(cap)}</span>
      </p>
      <div className="mt-2 h-1 w-full rounded" style={{ background: "var(--rule)" }}>
        <div className="h-1 rounded" style={{ width: `${pct}%`, background: pct >= 100 ? "var(--warning)" : "var(--accent)" }} />
      </div>
      {note && <p className="hint">{note}</p>}
    </div>
  );
}
