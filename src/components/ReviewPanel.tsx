"use client";

import { useState } from "react";
import { REVIEW_LABEL, type ReviewDecision } from "@/lib/review";

export type ReviewState = {
  review_decision?: ReviewDecision | null;
  review_note?: string | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
};

/**
 * Where a person settles something the agent left for review: a note, then
 * "good" or "not good". Once given, the verdict is shown with who gave it and
 * can be changed or withdrawn.
 *
 * The page updates from Realtime once the server writes the verdict, so
 * `onSaved` is only a nudge for callers that want to reload sooner.
 */
export function ReviewPanel({
  endpoint,
  current,
  subject,
  goodHint,
  notGoodHint,
  onSaved,
}: {
  endpoint: string;
  current: ReviewState;
  /** What is being reviewed, for the prompt: "this lead", "this run". */
  subject: string;
  goodHint: string;
  notGoodHint: string;
  onSaved?: () => void;
}) {
  const decided = current.review_decision ?? null;
  const [editing, setEditing] = useState(!decided);
  const [note, setNote] = useState(current.review_note ?? "");
  const [busy, setBusy] = useState<ReviewDecision | "undo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(decision: ReviewDecision | null) {
    setBusy(decision ?? "undo");
    setError(null);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, note }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(body.error ?? `Could not save the review (${res.status}).`);
      return;
    }
    setEditing(decision === null);
    if (decision === null) setNote("");
    onSaved?.();
  }

  if (decided && !editing) {
    return (
      <div className={`panel ${decided === "good" ? "panel-success" : "panel-danger"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">{REVIEW_LABEL[decided]}</p>
          <div className="flex gap-1">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
              Change
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy !== null}
              onClick={() => save(null)}
            >
              {busy === "undo" ? "Withdrawing…" : "Withdraw"}
            </button>
          </div>
        </div>
        {current.review_note && <p className="preformatted mt-1 text-sm">{current.review_note}</p>}
        <p className="hint mt-1">
          {current.reviewed_by_name ? `By ${current.reviewed_by_name}` : "Reviewed"}
          {current.reviewed_at ? ` · ${new Date(current.reviewed_at).toLocaleString()}` : ""}
        </p>
        {error && <p className="panel panel-danger mt-2">{error}</p>}
      </div>
    );
  }

  return (
    <div className="panel panel-warning">
      <p className="font-medium">Review {subject}</p>
      <label className="label mt-2 block" htmlFor={`note-${endpoint}`}>
        Note <span className="hint">(what you checked, and why)</span>
      </label>
      <textarea
        id={`note-${endpoint}`}
        className="field"
        rows={2}
        maxLength={2000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. LinkedIn shows 11–50 employees; fits."
        disabled={busy !== null}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy !== null}
          onClick={() => save("good")}
          title={goodHint}
        >
          {busy === "good" ? "Saving…" : "Reviewed: good"}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy !== null}
          onClick={() => save("not_good")}
          title={notGoodHint}
        >
          {busy === "not_good" ? "Saving…" : "Reviewed: not good"}
        </button>
        {decided && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
      </div>
      <p className="hint mt-2">
        <b>Good:</b> {goodHint} <b>Not good:</b> {notGoodHint}
      </p>
      {error && <p className="panel panel-danger mt-2">{error}</p>}
    </div>
  );
}
