"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/ConfirmButton";

/**
 * The two irreversible things you can do to a run, plus the exports.
 *
 * Cancel keeps the partial evidence; delete takes it and everything recorded
 * under it. Both ask first, and both name the run so the question is about
 * something specific.
 */
export function RunActions({
  runId,
  objective,
  live,
  hasQualified,
  logOpen,
  onToggleLog,
  logCount,
}: {
  runId: string;
  objective: string;
  live: boolean;
  hasQualified: boolean;
  logOpen: boolean;
  onToggleLog: () => void;
  logCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"cancel" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shortObjective = objective.length > 60 ? `${objective.slice(0, 60)}…` : objective;

  async function act(kind: "cancel" | "delete") {
    setBusy(kind);
    setError(null);
    const res = await fetch(kind === "cancel" ? `/api/runs/${runId}/cancel` : `/api/runs/${runId}`, {
      method: kind === "cancel" ? "POST" : "DELETE",
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);

    if (!res.ok) {
      setError(body.error ?? `Could not ${kind} the run (${res.status}).`);
      return;
    }
    if (kind === "delete") router.push("/");
    else router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`btn btn-sm ${logOpen ? "btn-primary" : ""}`}
          onClick={onToggleLog}
          aria-expanded={logOpen}
        >
          Log
          {logCount > 0 && <span style={{ opacity: 0.7 }}>{logCount}</span>}
        </button>

        {live && (
          <ConfirmButton
            label="Cancel run"
            confirmLabel="Stop the run"
            question="Stop this run now?"
            detail={`"${shortObjective}" — everything found so far is kept, but the agent will not finish or write outreach drafts.`}
            busy={busy === "cancel"}
            busyLabel="Stopping…"
            onConfirm={() => act("cancel")}
          />
        )}

        {!live && hasQualified && (
          <>
            <a className="btn btn-sm" href={`/runs/${runId}/pack`}>
              Outreach sample pack
            </a>
            <a className="btn btn-sm" href={`/api/runs/${runId}/export?format=md`}>
              Download Markdown
            </a>
            <a className="btn btn-sm" href={`/api/runs/${runId}/export?format=csv`}>
              Lead list CSV
            </a>
          </>
        )}

        <ConfirmButton
          label="Delete"
          confirmLabel="Delete everything"
          question="Delete this run and all of its evidence?"
          detail={`"${shortObjective}" — the candidates, scraped pages, qualification decisions, drafts and the whole tool-call log go with it. This cannot be undone.`}
          tone="danger"
          busy={busy === "delete"}
          busyLabel="Deleting…"
          onConfirm={() => act("delete")}
        />
      </div>

      {error && <p className="panel panel-danger">{error}</p>}
    </div>
  );
}
