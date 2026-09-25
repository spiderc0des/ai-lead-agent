"use client";

import { useState } from "react";

export type ProcessedState = {
  processed_at?: string | null;
  processed_by_name?: string | null;
  processed_note?: string | null;
};

/**
 * Marks a qualified lead as processed by the team after the run — contacted,
 * handed to sales, or decided against — so the next person looking at the list
 * knows it has been dealt with. Ticking "add to the skip list" (on by default)
 * also stops every later run from rediscovering and re-scraping it.
 */
export function ProcessedPanel({
  endpoint,
  current,
  onSaved,
}: {
  endpoint: string;
  current: ProcessedState;
  onSaved?: () => void;
}) {
  const [note, setNote] = useState("");
  const [suppress, setSuppress] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function save(processed: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ processed, note, suppress: processed && suppress }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? `Could not save (${res.status}).`);
      return;
    }
    if (processed && body.suppressed) setMessage("Added to the skip list — future runs won't rediscover it.");
    setNote("");
    onSaved?.();
  }

  if (current.processed_at) {
    return (
      <div className="panel panel-success">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">Processed by the team</p>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save(false)}>
            {busy ? "Undoing…" : "Undo"}
          </button>
        </div>
        {current.processed_note && <p className="preformatted mt-1 text-sm">{current.processed_note}</p>}
        <p className="hint mt-1">
          {current.processed_by_name ? `By ${current.processed_by_name}` : "Processed"} ·{" "}
          {new Date(current.processed_at).toLocaleString()}
        </p>
        {message && <p className="hint mt-1">{message}</p>}
        {error && <p className="panel panel-danger mt-2">{error}</p>}
      </div>
    );
  }

  return (
    <div className="panel">
      <p className="font-medium">Done with this lead?</p>
      <label className="label mt-2 block" htmlFor={`processed-${endpoint}`}>
        Note <span className="hint">(what happened: contacted, handed on, not pursuing…)</span>
      </label>
      <textarea
        id={`processed-${endpoint}`}
        className="field"
        rows={2}
        maxLength={2000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Sent email 1 on 25 Sep from HubSpot."
        disabled={busy}
      />
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={suppress} onChange={(e) => setSuppress(e.target.checked)} disabled={busy} />
        Add to the skip list so future runs don&apos;t rediscover it
      </label>
      <button type="button" className="btn btn-primary btn-sm mt-2" disabled={busy} onClick={() => save(true)}>
        {busy ? "Saving…" : "Mark as processed"}
      </button>
      {error && <p className="panel panel-danger mt-2">{error}</p>}
    </div>
  );
}
