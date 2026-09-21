"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LIMITS, type RunLimits } from "@/lib/schemas";

type Budget = {
  apify_remaining_usd: number;
  agent_remaining_usd: number;
  agent_cap_usd: number;
  apify_cap_usd: number;
  runs_paused: boolean;
};

const EXAMPLE =
  "Find 10 US B2B SaaS companies with 10 to 100 employees that may need AI automation support.";

export function NewRunForm({ hasActiveRun }: { hasActiveRun: boolean }) {
  const router = useRouter();
  const [objective, setObjective] = useState("");
  const [limits, setLimits] = useState<RunLimits>(DEFAULT_LIMITS);
  const [showLimits, setShowLimits] = useState(false);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/budget")
      .then((r) => (r.ok ? r.json() : null))
      .then(setBudget)
      .catch(() => setBudget(null));
  }, []);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective, limits }),
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(body.error ?? `Could not start the run (${res.status}).`);
      setBusy(false);
      return;
    }
    router.push(`/runs/${body.runId}`);
  }

  const blocked = hasActiveRun || budget?.runs_paused;

  return (
    <form onSubmit={start} className="rounded-lg border border-neutral-200 p-5">
      <h2 className="text-sm font-semibold">New run</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Describe who you want to reach. The agent refines this into ICP criteria before it
        searches.
      </p>

      <textarea
        value={objective}
        onChange={(e) => setObjective(e.target.value)}
        rows={3}
        required
        minLength={10}
        placeholder={EXAMPLE}
        className="mt-4 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
      />
      <button
        type="button"
        onClick={() => setObjective(EXAMPLE)}
        className="mt-1 text-xs text-neutral-500 underline underline-offset-4"
      >
        use the example objective
      </button>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setShowLimits((s) => !s)}
          className="text-xs text-neutral-600 underline underline-offset-4"
        >
          {showLimits ? "hide limits" : "adjust limits"}
        </button>

        {showLimits && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(
              [
                ["max_candidates", "Candidates"],
                ["max_scrapes", "Scrapes"],
                ["max_leads", "Qualified leads"],
                ["max_turns", "Agent turns"],
                ["max_budget_usd", "Model budget ($)"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="text-xs text-neutral-600">
                {label}
                <input
                  type="number"
                  step={key === "max_budget_usd" ? "0.25" : "1"}
                  value={limits[key]}
                  onChange={(e) =>
                    setLimits({ ...limits, [key]: Number(e.target.value) })
                  }
                  className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                />
              </label>
            ))}
          </div>
        )}
      </div>

      {budget && (
        <p className="mt-4 text-xs text-neutral-500">
          Shared budget left — discovery ${budget.apify_remaining_usd.toFixed(3)} of $
          {budget.apify_cap_usd.toFixed(2)} · model ${budget.agent_remaining_usd.toFixed(2)} of $
          {budget.agent_cap_usd.toFixed(2)}. These pools are shared by everyone using this app.
        </p>
      )}

      {hasActiveRun && (
        <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          You already have a run in progress. One at a time — the workers are shared.
        </p>
      )}
      {budget?.runs_paused && (
        <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          New runs are paused by an administrator.
        </p>
      )}
      {error && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || blocked || objective.trim().length < 10}
        className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        {busy ? "Starting…" : "Start run"}
      </button>
    </form>
  );
}
