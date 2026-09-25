"use client";

import { useState } from "react";
import Link from "next/link";
import { StatusPill } from "@/components/StatusPill";
import { REVIEW_LABEL, type ReviewDecision } from "@/lib/review";

export type RunRow = {
  id: string;
  objective: string;
  status: string;
  created_at: string;
  total_cost_usd: number | null;
  limits: { max_budget_usd?: number; max_leads?: number } | null;
  qualified: number;
  parent_run_id: string | null;
  /** A person's verdict on a needs_review run. */
  review_decision?: ReviewDecision | null;
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active / waiting" },
  { key: "completed", label: "Completed" },
  { key: "needs_review", label: "Needs review" },
  { key: "failed", label: "Failed" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function matches(run: RunRow, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "active")
    return (
      run.status === "queued" ||
      run.status === "running" ||
      run.status === "needs_clarification" ||
      run.status === "awaiting_confirmation"
    );
  if (filter === "failed") return run.status === "failed" || run.status === "cancelled";
  return run.status === filter;
}

export function RunsList({ runs }: { runs: RunRow[] }) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const shown = runs.filter((r) => matches(r, filter));

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const n = runs.filter((r) => matches(r, f.key)).length;
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={active}
              className={`btn btn-sm ${active ? "btn-primary" : ""}`}
            >
              {f.label}
              <span style={{ opacity: 0.7 }}>{n}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="mt-4 text-sm" style={{ color: "var(--ink-faint)" }}>
          {runs.length === 0 ? "No runs yet." : `No ${filter === "all" ? "" : filter.replace("_", " ")} runs.`}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {shown.map((run) => (
            <li key={run.id}>
              <Link href={`/runs/${run.id}`} className="card card-link flex items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {run.parent_run_id && (
                      <span className="chip mr-1.5">continued</span>
                    )}
                    {run.objective}
                  </p>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--ink-faint)" }}>
                    {new Date(run.created_at).toLocaleString()} · {run.qualified} of{" "}
                    {run.limits?.max_leads ?? "—"} qualified · ${Number(run.total_cost_usd ?? 0).toFixed(4)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusPill status={run.status} />
                  {run.review_decision ? (
                    <span className={run.review_decision === "good" ? "badge badge-success" : "badge badge-danger"}>
                      {REVIEW_LABEL[run.review_decision]}
                    </span>
                  ) : run.status === "needs_review" ? (
                    <span className="hint">not reviewed yet</span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
