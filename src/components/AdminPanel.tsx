"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/ConfirmButton";

type Budget = {
  apify_cap_usd: number;
  apify_spent_usd: number;
  apify_reserved_usd: number;
  agent_cap_usd: number;
  agent_spent_usd: number;
  agent_reserved_usd: number;
  runs_paused: boolean;
  /** Absent until 0007_workers.sql is applied. */
  max_concurrent_runs?: number;
  max_runs_per_user?: number;
};

const WORKER_CEILING = 8;
const PER_USER_CEILING = 5;

export function AdminPanel({ budget, runningNow }: { budget: Budget; runningNow: number }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [apifyCap, setApifyCap] = useState(budget.apify_cap_usd);
  const [agentCap, setAgentCap] = useState(budget.agent_cap_usd);
  const [busy, setBusy] = useState(false);
  const workerColumnsExist = budget.max_concurrent_runs !== undefined;
  const [workers, setWorkers] = useState(budget.max_concurrent_runs ?? 2);
  const [perUser, setPerUser] = useState(budget.max_runs_per_user ?? 1);

  async function post(url: string, body: unknown) {
    setBusy(true);
    setNote(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setNote(res.ok ? (data.note ?? "Saved.") : (data.error ?? `Failed (${res.status})`));
    router.refresh();
  }

  const apifyLeft = budget.apify_cap_usd - budget.apify_spent_usd - budget.apify_reserved_usd;
  const agentLeft = budget.agent_cap_usd - budget.agent_spent_usd - budget.agent_reserved_usd;

  return (
    <div className="space-y-6">
      <section className="card">
        <h2 className="text-sm font-semibold">Shared budget</h2>
        <p className="hint">
          One pool across every user. Reservations are held while a run is in flight and settled
          against the real cost when it finishes.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <BudgetCard
            title="Apify discovery"
            cap={budget.apify_cap_usd}
            spent={budget.apify_spent_usd}
            reserved={budget.apify_reserved_usd}
            left={apifyLeft}
          />
          <BudgetCard
            title="Model spend"
            cap={budget.agent_cap_usd}
            spent={budget.agent_spent_usd}
            reserved={budget.agent_reserved_usd}
            left={agentLeft}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="label">
            Apify cap ($)
            <input
              type="number"
              step="0.5"
              value={apifyCap}
              onChange={(e) => setApifyCap(Number(e.target.value))}
              className="field mt-1 w-28"
            />
          </label>
          <label className="label">
            Model cap ($)
            <input
              type="number"
              step="1"
              value={agentCap}
              onChange={(e) => setAgentCap(Number(e.target.value))}
              className="field mt-1 w-28"
            />
          </label>
          <button
            disabled={busy}
            onClick={() =>
              post("/api/admin/budget", { apify_cap_usd: apifyCap, agent_cap_usd: agentCap })
            }
            className="btn btn-primary btn-sm"
          >
            Save caps
          </button>
          <ConfirmButton
            label={budget.runs_paused ? "Resume new runs" : "Pause new runs"}
            confirmLabel={budget.runs_paused ? "Resume" : "Pause"}
            question={budget.runs_paused ? "Let everyone start runs again?" : "Stop everyone starting new runs?"}
            detail={
              budget.runs_paused
                ? "Anything already queued will begin immediately."
                : "Runs already in flight keep going; only new ones are refused. This affects every user."
            }
            busy={busy}
            onConfirm={() => post("/api/admin/budget", { runs_paused: !budget.runs_paused })}
          />
        </div>
      </section>

      <section className="card">
        <h2 className="text-sm font-semibold">Workers</h2>
        <p className="hint">
          How many runs execute at once, and how many one person may have going. Runs beyond either
          limit wait in the queue and start as a slot frees up.
        </p>

        {!workerColumnsExist && (
          <p className="panel panel-warning mt-3">
            Apply <code>supabase/migrations/0007_workers.sql</code> to change these. Until then the app
            uses {budget.max_concurrent_runs ?? 2} workers and one run per person.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="text-xs">
            <span className="label">Workers (all users)</span>
            <input
              type="number"
              min={1}
              max={WORKER_CEILING}
              value={workers}
              disabled={!workerColumnsExist}
              onChange={(e) => setWorkers(Number(e.target.value))}
              className="field mt-1 w-28"
            />
          </label>
          <label className="text-xs">
            <span className="label">Runs per person</span>
            <input
              type="number"
              min={1}
              max={Math.min(PER_USER_CEILING, workers)}
              value={perUser}
              disabled={!workerColumnsExist}
              onChange={(e) => setPerUser(Number(e.target.value))}
              className="field mt-1 w-28"
            />
          </label>
          <button
            disabled={
              busy ||
              !workerColumnsExist ||
              workers < 1 ||
              workers > WORKER_CEILING ||
              perUser < 1 ||
              perUser > PER_USER_CEILING
            }
            onClick={() =>
              post("/api/admin/budget", { max_concurrent_runs: workers, max_runs_per_user: perUser })
            }
            className="btn btn-primary btn-sm"
          >
            Save workers
          </button>
        </div>

        <p className="hint mt-3">
          {runningNow} running now. Each worker runs its own Claude Code process, roughly 300-400 MB of
          memory, so the container&apos;s memory is the real ceiling — on 1 GB, more than 2 or 3 at once
          risks it being killed mid-run.
          {perUser > workers && " Runs per person above the worker count has no effect."}
        </p>
      </section>


      {note && (
        <p className="panel panel-info">{note}</p>
      )}
    </div>
  );
}

function BudgetCard({
  title,
  cap,
  spent,
  reserved,
  left,
}: {
  title: string;
  cap: number;
  spent: number;
  reserved: number;
  left: number;
}) {
  const pct = cap > 0 ? Math.min(100, ((spent + reserved) / cap) * 100) : 0;
  return (
    <div className="card p-3">
      <p className="text-xs" style={{ color: "var(--ink-faint)" }}>{title}</p>
      <p className="mt-1 text-lg font-medium tabular-nums">
        ${left.toFixed(4)} <span className="text-sm font-normal text-neutral-400">left</span>
      </p>
      <div className="mt-2 h-1 w-full rounded" style={{ background: "var(--rule)" }}>
        <div
          className="h-1 rounded"
          style={{ width: `${pct}%`, background: pct > 90 ? "var(--warning)" : "var(--accent)" }}
        />
      </div>
      <p className="hint">
        spent ${spent.toFixed(4)} · reserved ${reserved.toFixed(4)} · cap ${cap.toFixed(2)}
      </p>
    </div>
  );
}
