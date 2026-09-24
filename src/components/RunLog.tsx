"use client";

import { useState } from "react";

export type RunEvent = {
  id: number;
  kind: string;
  actor_email: string | null;
  /** The person's name at the time. Absent before 0008_names_roles.sql. */
  actor_name?: string | null;
  detail: Record<string, unknown>;
  created_at: string;
};

type QA = { question: string; answer: string };

/**
 * Who did what to this run, and when.
 *
 * The objective is shown first and verbatim, because answers are recorded
 * separately rather than folded into it — so the log always shows what was
 * originally asked alongside everything added since.
 */
export function RunLog({ objective, events }: { objective: string; events: RunEvent[] }) {
  return (
    <div className="card">
      <p className="label">Initial objective</p>
      <p className="preformatted text-sm">{objective}</p>

      <p className="label mt-4">History</p>
      {events.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--ink-faint)" }}>
          No history recorded — this run predates the log.
        </p>
      ) : (
        <ol className="relative ml-1.5 space-y-3 border-l pl-4" style={{ borderColor: "var(--rule)" }}>
          {events.map((e) => (
            <LogEntry key={e.id} event={e} />
          ))}
        </ol>
      )}
    </div>
  );
}

function LogEntry({ event: e }: { event: RunEvent }) {
  const who = e.actor_name?.trim() || e.actor_email || "the agent";
  const d = e.detail ?? {};
  const questions = (d.questions as string[] | undefined) ?? [];
  const answers = (d.answers as QA[] | undefined) ?? [];
  const reason = d.reason as string | null | undefined;

  const { title, tone, body } = describe(e.kind, who, reason, questions, answers, d);

  return (
    <li className="relative">
      <span
        className="absolute -left-[1.4rem] top-1.5 inline-block h-2 w-2 rounded-full"
        style={{ background: tone }}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-sm font-medium">{title}</p>
        <time className="text-xs tabular-nums" style={{ color: "var(--ink-faint)" }} dateTime={e.created_at}>
          {new Date(e.created_at).toLocaleString()}
        </time>
      </div>
      {body}
    </li>
  );
}

function describe(
  kind: string,
  who: string,
  reason: string | null | undefined,
  questions: string[],
  answers: QA[],
  d: Record<string, unknown>,
): { title: string; tone: string; body: React.ReactNode } {
  const accent = "var(--accent)";
  const warn = "var(--warning)";
  const ok = "var(--success)";
  const bad = "var(--danger)";
  const muted = "var(--ink-faint)";

  switch (kind) {
    case "created":
      return {
        title: `Started by ${who}`,
        tone: accent,
        body: d.require_icp_confirmation ? (
          <p className="hint">Asked to review the criteria before searching.</p>
        ) : null,
      };
    case "started":
      return { title: "Agent began work", tone: muted, body: null };
    case "resumed":
      // With an actor, a person picked an interrupted run back up; without
      // one, it is the agent starting its next session.
      if (who !== "the agent") {
        return {
          title: `Resumed by ${who}`,
          tone: accent,
          body: d.from ? <p className="hint">Picked up after the run {String(d.from)}.</p> : null,
        };
      }
      return {
        title: "Agent resumed",
        tone: muted,
        body:
          typeof d.spent_so_far_usd === "number" && d.spent_so_far_usd > 0 ? (
            <p className="hint">
              ${Number(d.spent_so_far_usd).toFixed(2)} spent before the pause; this session may use
              up to ${Number(d.session_budget_usd).toFixed(2)}.
            </p>
          ) : null,
      };
    case "needs_clarification":
      return {
        title: `Paused — the agent asked ${questions.length} question${questions.length === 1 ? "" : "s"}`,
        tone: warn,
        body: questions.length ? (
          <Fold label="Questions">
            <ul className="list-disc pl-5 text-sm">
              {questions.map((q) => <li key={q}>{q}</li>)}
            </ul>
          </Fold>
        ) : null,
      };
    case "answered":
      return {
        title: `Answered by ${who}`,
        tone: accent,
        body: answers.length ? (
          <Fold label={`${answers.length} answer${answers.length === 1 ? "" : "s"}`}>
            <dl className="space-y-2 text-sm">
              {answers.map((a) => (
                <div key={a.question}>
                  <dt style={{ color: "var(--ink-soft)" }}>{a.question}</dt>
                  <dd className="font-medium">{a.answer}</dd>
                </div>
              ))}
            </dl>
          </Fold>
        ) : null,
      };
    case "awaiting_confirmation":
      return { title: "Paused — criteria written, waiting for approval", tone: warn, body: null };
    case "approved":
      return { title: `Criteria approved by ${who}`, tone: ok, body: null };
    case "cancelled":
      return {
        // A person-cancel carries an actor; a time-limit stop does not.
        title: who === "the agent" ? "Stopped" : `Cancelled by ${who}`,
        tone: muted,
        body: reason ? <p className="hint">{reason}</p> : null,
      };
    case "completed":
      return { title: "Completed", tone: ok, body: reason ? <p className="hint">{reason}</p> : null };
    case "needs_review":
      return { title: "Finished — needs review", tone: warn, body: reason ? <p className="hint">{reason}</p> : null };
    case "failed":
      return { title: "Failed", tone: bad, body: reason ? <p className="hint">{reason}</p> : null };
    case "emailed":
      return {
        title: `Emailed the owner: ${String(d.about ?? "update")}`,
        tone: muted,
        body: <p className="hint">Sent to {String(d.to ?? "the owner")}.</p>,
      };
    case "email_failed":
      return {
        title: `Email not sent: ${String(d.about ?? "update")}`,
        tone: bad,
        body: <p className="hint">{reason ?? "The mail server refused it."}</p>,
      };
    default:
      return { title: kind.replace(/_/g, " "), tone: muted, body: null };
  }
}

function Fold({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs"
        style={{ color: "var(--accent)" }}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor"
             strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
             style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .12s" }}>
          <path d="M6 3l5 5-5 5" />
        </svg>
        {label}
      </button>
      {open && <div className="mt-1.5 rounded-[var(--radius)] p-2.5" style={{ background: "var(--paper)" }}>{children}</div>}
    </div>
  );
}
