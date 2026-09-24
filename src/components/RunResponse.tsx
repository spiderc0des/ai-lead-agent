"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The reply to a run that stopped waiting on a person.
 *
 * Answering resumes THIS run. The replies are recorded in its log with who
 * gave them, and the agent picks up with everything the run already found.
 */
export function RunResponse({
  runId,
  mode,
  questions,
  objective = "",
}: {
  runId: string;
  mode: "clarify" | "confirm";
  questions: string[];
  /** The objective the criteria were written from, to start an edit from. */
  objective?: string;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(objective);
  const unchanged = draft.trim() === objective.trim();

  async function submit(payload?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/runs/${runId}/continue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? (mode === "confirm" ? { approve: true } : { answers })),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? `Could not continue (${res.status}).`);
      return;
    }
    // Same run: refresh in place rather than navigating away.
    setEditing(false);
    router.refresh();
  }

  if (mode === "confirm") {
    return (
      <div className="panel panel-info">
        <p className="font-medium">These criteria are waiting for your approval.</p>
        <p className="hint">
          Nothing has been searched yet. Approving resumes this run from discovery.
        </p>
        {editing ? (
          <div className="mt-3">
            <label htmlFor="new-objective" className="label">
              Updated qualification objective
            </label>
            <textarea
              id="new-objective"
              className="field"
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
              autoFocus
            />
            <p className="hint">
              The agent refines the criteria again from this, in this same run, then stops for
              your approval. A number like &quot;find 5…&quot; also sets how many leads it qualifies.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy || draft.trim().length < 10 || unchanged}
                onClick={() => submit({ new_objective: draft })}
              >
                {busy ? "Refining…" : "Refine the criteria again"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setDraft(objective);
                  setError(null);
                }}
              >
                Cancel
              </button>
              {unchanged && draft.trim().length >= 10 && (
                <span className="hint">Change the objective to refine again.</span>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => submit()}>
              {busy ? "Resuming…" : "Approve and continue"}
            </button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setEditing(true)}>
              Update qualification objective
            </button>
          </div>
        )}
        {error && <p className="panel panel-danger mt-3">{error}</p>}
      </div>
    );
  }

  const answered = answers.filter((a) => a.trim()).length;

  return (
    <div className="panel panel-info">
      <p className="font-medium">
        The agent needs a little more before it searches. Answer what you can.
      </p>

      <div className="mt-3 space-y-3">
        {questions.map((q, i) => (
          <div key={q}>
            <label htmlFor={`q-${i}`} className="label">
              {q}
            </label>
            <input
              id={`q-${i}`}
              className="field"
              value={answers[i] ?? ""}
              placeholder="Skip any you are not sure about"
              onChange={(e) => {
                const next = [...answers];
                next[i] = e.target.value;
                setAnswers(next);
              }}
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || answered === 0}
          onClick={() => submit()}
        >
          {busy ? "Resuming…" : "Continue the run"}
        </button>
        <span className="hint">
          {answered === 0
            ? "Answer at least one to continue."
            : `${answered} of ${questions.length} answered.`}
        </span>
      </div>

      {error && <p className="panel panel-danger mt-3">{error}</p>}
    </div>
  );
}
