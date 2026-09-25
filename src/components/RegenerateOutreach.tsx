"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Target = "all" | "emails" | "linkedin";

const TARGETS: { value: Target; label: string }[] = [
  { value: "all", label: "Emails and LinkedIn" },
  { value: "emails", label: "The 3 emails" },
  { value: "linkedin", label: "LinkedIn message" },
];

/**
 * Rewrite a lead's outreach with an instruction, or write it for the first
 * time. The new drafts replace the old only after they pass the same checks
 * the agent's drafts do; a rewrite that can't meet them leaves the old ones.
 */
export function RegenerateOutreach({
  runId,
  leadId,
  hasDrafts,
}: {
  runId: string;
  leadId: string;
  hasDrafts: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!hasDrafts);
  const [target, setTarget] = useState<Target>("all");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    const res = await fetch(`/api/runs/${runId}/leads/${leadId}/outreach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: hasDrafts ? target : "all", instruction }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setResult({ ok: false, text: data.error ?? `Could not write the drafts (${res.status}).` });
      return;
    }
    setResult({
      ok: true,
      text: `${hasDrafts ? "Rewritten" : "Written"} for $${Number(data.costUsd ?? 0).toFixed(3)}${data.attempts > 1 ? ", after one retry to fix a rule it broke" : ""}.`,
    });
    setInstruction("");
    if (hasDrafts) setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
          Regenerate with an instruction
        </button>
        {result && <span className="hint" style={{ color: result.ok ? "var(--success)" : "var(--danger)" }}>{result.text}</span>}
      </div>
    );
  }

  return (
    <div className="panel">
      <p className="font-medium">{hasDrafts ? "Regenerate outreach" : "No outreach yet"}</p>
      {!hasDrafts && (
        <p className="hint">
          Writes the 3 emails and the LinkedIn message from the pages this run read, with the same
          rules as the agent&apos;s drafts.
        </p>
      )}
      {hasDrafts && (
        <label className="mt-2 block text-xs" htmlFor={`target-${leadId}`}>
          <span className="label">Rewrite</span>
          <select
            id={`target-${leadId}`}
            className="field mt-1 w-auto"
            value={target}
            onChange={(e) => setTarget(e.target.value as Target)}
            disabled={busy}
          >
            {TARGETS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
      )}
      <label className="label mt-2 block" htmlFor={`instruction-${leadId}`}>
        Instruction <span className="hint">({hasDrafts ? "what to change" : "optional"})</span>
      </label>
      <textarea
        id={`instruction-${leadId}`}
        className="field"
        rows={2}
        maxLength={1000}
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder={
          hasDrafts
            ? "e.g. Make email 2 about their open Customer Adoption role, and keep email 1 under 60 words."
            : "e.g. Lead with their recent Series A."
        }
        disabled={busy}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || (hasDrafts && instruction.trim().length < 3)}
          onClick={run}
        >
          {busy ? "Writing… (about 30 seconds)" : hasDrafts ? "Regenerate" : "Write outreach"}
        </button>
        {hasDrafts && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </button>
        )}
        <span className="hint">Uses the shared model budget, usually a few cents.</span>
      </div>
      {result && <p className={`panel mt-2 ${result.ok ? "panel-success" : "panel-danger"}`}>{result.text}</p>}
    </div>
  );
}
