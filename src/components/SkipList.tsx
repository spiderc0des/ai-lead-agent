"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/ConfirmButton";

export type SkipRow = {
  domain: string;
  reason: "customer" | "contacted" | "excluded" | "other";
  note: string | null;
  added_by: string | null;
  added_by_name: string | null;
  created_at: string;
};

const REASONS: { value: SkipRow["reason"]; label: string }[] = [
  { value: "customer", label: "Existing customer" },
  { value: "contacted", label: "Already contacted" },
  { value: "excluded", label: "Asked to exclude" },
  { value: "other", label: "Other" },
];
const reasonLabel = (r: string) => REASONS.find((x) => x.value === r)?.label ?? r;

export function SkipList({ rows, meId, isAdmin }: { rows: SkipRow[]; meId: string; isAdmin: boolean }) {
  const router = useRouter();
  const [domains, setDomains] = useState("");
  const [reason, setReason] = useState<SkipRow["reason"]>("customer");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [query, setQuery] = useState("");

  async function call(method: "POST" | "DELETE", body: unknown) {
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/suppression", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setResult({ ok: res.ok, text: res.ok ? data.note : (data.error ?? `Failed (${res.status})`) });
    if (res.ok) router.refresh();
    return res.ok;
  }

  const shown = query.trim()
    ? rows.filter((r) => r.domain.includes(query.trim().toLowerCase()))
    : rows;

  return (
    <div className="mt-5 space-y-5">
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await call("POST", { domains, reason, note })) {
            setDomains("");
            setNote("");
          }
        }}
      >
        <h2 className="text-sm font-semibold">Add domains</h2>
        <label className="label mt-3 block" htmlFor="skip-domains">
          Domains <span className="hint">(one per line or comma-separated; full URLs are fine)</span>
        </label>
        <textarea
          id="skip-domains"
          className="field"
          rows={3}
          value={domains}
          onChange={(e) => setDomains(e.target.value)}
          placeholder={"acme.com\nhttps://www.globex.io/about"}
          disabled={busy}
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
          <label className="text-xs">
            <span className="label">Reason</span>
            <select className="field mt-1" value={reason} onChange={(e) => setReason(e.target.value as SkipRow["reason"])} disabled={busy}>
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="label">Note (optional)</span>
            <input className="field mt-1" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </label>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !domains.trim()}>
            {busy ? "Adding…" : "Add to skip list"}
          </button>
        </div>
        {result && <p className={`panel mt-3 ${result.ok ? "panel-success" : "panel-danger"}`}>{result.text}</p>}
      </form>

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {rows.length} domain{rows.length === 1 ? "" : "s"} skipped
          </h2>
          {rows.length > 8 && (
            <input className="field w-48 py-1 text-sm" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
          )}
        </div>
        {shown.length === 0 ? (
          <p className="hint mt-3">{rows.length ? "No match." : "Nothing on the list yet."}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="data">
              <thead>
                <tr><th>Domain</th><th>Reason</th><th>Note</th><th>Added</th><th></th></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.domain}>
                    <td className="font-mono text-xs">{r.domain}</td>
                    <td className="text-xs">{reasonLabel(r.reason)}</td>
                    <td className="max-w-xs text-xs">{r.note ?? ""}</td>
                    <td className="whitespace-nowrap text-xs" style={{ color: "var(--ink-faint)" }}>
                      {r.added_by_name ?? "—"} · {new Date(r.created_at).toLocaleDateString()}
                    </td>
                    <td className="text-right">
                      {(isAdmin || r.added_by === meId) && (
                        <ConfirmButton
                          label="Remove"
                          confirmLabel="Remove"
                          question={`Take ${r.domain} off the skip list?`}
                          detail="Future runs may discover and pitch it again."
                          busy={busy}
                          onConfirm={() => void call("DELETE", { domain: r.domain })}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
