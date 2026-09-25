"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CopyButton } from "@/components/CopyButton";

export type Draft = {
  id: string;
  lead_id: string;
  channel: string;
  step_number: number;
  subject: string | null;
  body: string;
  personalization_note: string | null;
  evidence_url: string | null;
};

/**
 * One lead's outreach, laid out to be reviewed and then pasted.
 *
 * Every piece has its own copy button, plus one for the whole sequence: the
 * useful unit is sometimes a single email and sometimes the lot.
 */
type Target = "all" | "email_1" | "email_2" | "email_3" | "linkedin";

/** Where rewrites go. Absent, the card is read-only (a live run, or no permission). */
export type RewriteTarget = { runId: string; leadId: string; onDone?: () => void };

export function OutreachCard({
  companyName,
  companyDomain,
  drafts,
  rewrite,
}: {
  companyName: string;
  companyDomain: string;
  drafts: Draft[];
  rewrite?: RewriteTarget;
}) {
  const [open, setOpen] = useState<Target | null>(null);
  const toggle = (t: Target) => setOpen((o) => (o === t ? null : t));
  const rewriteToggle = (target: Target, label: string) =>
    rewrite ? (
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-expanded={open === target}
        onClick={() => toggle(target)}
      >
        {label}
      </button>
    ) : null;
  const emails = drafts
    .filter((d) => d.channel === "email")
    .sort((a, b) => a.step_number - b.step_number);
  const linkedin = drafts.find((d) => d.channel === "linkedin");

  const whole = [
    ...emails.map((e) => `--- Email ${e.step_number} ---\nSubject: ${e.subject ?? ""}\n\n${e.body}`),
    linkedin ? `--- LinkedIn ---\n\n${linkedin.body}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{companyName}</h3>
          <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
            {companyDomain}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {rewriteToggle("all", "Rewrite all")}
          <CopyButton value={whole} label="Copy all" />
        </div>
      </div>
      {rewrite && open === "all" && (
        <RewriteBox rewrite={rewrite} target="all" what="all three emails and the LinkedIn message" onClose={() => setOpen(null)} />
      )}

      {emails.length === 0 && (
        <p className="mt-3 text-sm" style={{ color: "var(--ink-faint)" }}>
          No drafts written for this lead.
        </p>
      )}

      <ol className="mt-4 space-y-3">
        {emails.map((e) => (
          <li key={e.id} className="rounded-[var(--radius)] border p-3" style={{ borderColor: "var(--rule)" }}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
                  Email {e.step_number}
                </p>
                <p className="text-sm font-medium">{e.subject}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                {rewriteToggle(`email_${e.step_number}` as Target, "Rewrite")}
                <CopyButton value={e.subject ?? ""} label="Subject" />
                <CopyButton value={e.body} label="Body" />
              </div>
            </div>
            {rewrite && open === `email_${e.step_number}` && (
              <RewriteBox
                rewrite={rewrite}
                target={`email_${e.step_number}` as Target}
                what={`email ${e.step_number}`}
                onClose={() => setOpen(null)}
              />
            )}
            <p className="preformatted mt-2">{e.body}</p>
            <p className="hint">
              {e.personalization_note}
              {e.evidence_url && (
                <>
                  {" · "}
                  <a href={e.evidence_url} target="_blank" rel="noreferrer noopener" style={{ color: "var(--accent)" }}>
                    evidence
                  </a>
                </>
              )}
            </p>
          </li>
        ))}
      </ol>

      {linkedin && (
        <div className="mt-3 rounded-[var(--radius)] border p-3" style={{ borderColor: "var(--rule)" }}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
              LinkedIn message
            </p>
            <div className="flex shrink-0 gap-1">
              {rewriteToggle("linkedin", "Rewrite")}
              <CopyButton value={linkedin.body} />
            </div>
          </div>
          {rewrite && open === "linkedin" && (
            <RewriteBox rewrite={rewrite} target="linkedin" what="the LinkedIn message" onClose={() => setOpen(null)} />
          )}
          <p className="preformatted mt-1.5">{linkedin.body}</p>
          {linkedin.personalization_note && <p className="hint">{linkedin.personalization_note}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * An instruction box for one rewrite. The new draft replaces the old only
 * after it passes the same checks the agent's drafts do; a rewrite that can't
 * meet them leaves the current text in place and says why.
 */
function RewriteBox({
  rewrite,
  target,
  what,
  onClose,
}: {
  rewrite: RewriteTarget;
  target: Target;
  what: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `rewrite-${rewrite.leadId}-${target}`;

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/runs/${rewrite.runId}/leads/${rewrite.leadId}/outreach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, instruction }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? `Could not rewrite (${res.status}).`);
      return;
    }
    onClose();
    rewrite.onDone?.();
    router.refresh();
  }

  return (
    <div className="panel mt-2">
      <label className="label block" htmlFor={id}>
        How should {what} change?
      </label>
      <textarea
        id={id}
        className="field"
        rows={2}
        maxLength={1000}
        autoFocus
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder={
          target === "linkedin"
            ? "e.g. Mention their open Operations role and keep it under 250 characters."
            : "e.g. Lead with their 24/7 call answering, and make it shorter."
        }
        disabled={busy}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || instruction.trim().length < 3}
          onClick={run}
        >
          {busy ? "Rewriting… (about 20 seconds)" : `Rewrite ${what}`}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <span className="hint">Written from the pages this run read. A few cents from the shared budget.</span>
      </div>
      {error && <p className="panel panel-danger mt-2">{error}</p>}
    </div>
  );
}
