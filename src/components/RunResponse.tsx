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
}: {
  runId: string;
  mode: "clarify" | "confirm";
  questions: string[];
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/runs/${runId}/continue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mode === "confirm" ? { approve: true } : { answers }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? `Could not continue (${res.status}).`);
      return;
    }
    // Same run: refresh in place rather than navigating away.
    router.refresh();
  }

  if (mode === "confirm") {
    return (
      <div className="panel panel-info">
        <p className="font-medium">These criteria are waiting for your approval.</p>
        <p className="hint">
          Nothing has been searched yet. Approving resumes this run from discovery.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={submit}>
            {busy ? "Resuming…" : "Approve and continue"}
          </button>
          <a className="btn btn-sm no-underline" href="/new">
            Start over instead
          </a>
        </div>
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
          onClick={submit}
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
