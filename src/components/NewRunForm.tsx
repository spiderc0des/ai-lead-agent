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

/**
 * The two kinds of limit behave very differently when reached, which is the
 * thing worth knowing before you change one:
 *
 *   "soft" — the TOOL refuses the next call. The agent is told the refusal is
 *            final, works with what it has, and still closes the run properly.
 *   "hard" — the SESSION is killed mid-thought. No finalize_run, so the run
 *            ends `failed` with partial data and no quality check.
 */
const LIMIT_FIELDS = [
  {
    key: "max_candidates",
    label: "Candidates",
    help: "Companies discovery may collect, before any are read.",
    stop: "soft",
  },
  {
    key: "max_scrapes",
    label: "Scrapes",
    help: "Pages that may be read. The main driver of run time and Firecrawl credits.",
    stop: "soft",
  },
  {
    key: "max_leads",
    label: "Qualified leads",
    help: "How many may be saved as qualified. Rejections are unlimited.",
    stop: "soft",
  },
  {
    key: "max_turns",
    label: "Agent turns",
    help: "Model round trips, tool calls included.",
    stop: "hard",
  },
  {
    key: "max_budget_usd",
    label: "Model budget ($)",
    help: "Ceiling for this run. Reserved from the shared pool while it runs.",
    stop: "hard",
  },
] as const;

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
            {LIMIT_FIELDS.map(({ key, label, help, stop }) => (
              <label key={key} className="text-xs text-neutral-600">
                <span className="font-medium text-neutral-800">{label}</span>
                <input
                  type="number"
                  step={key === "max_budget_usd" ? "0.25" : "1"}
                  value={limits[key]}
                  onChange={(e) =>
                    setLimits({ ...limits, [key]: Number(e.target.value) })
                  }
                  className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                />
                <span className="mt-1 block leading-snug text-neutral-500">
                  {help}{" "}
                  <span className={stop === "hard" ? "text-amber-700" : "text-neutral-500"}>
                    {stop === "hard" ? "Hits it and the run is cut off." : "Hits it and the agent adapts."}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      {budget && (
        <p className="mt-4 text-xs text-neutral-500">
          Shared budget left — discovery ${budget.apify_remaining_usd.toFixed(2)} of $
          {budget.apify_cap_usd.toFixed(2)} · model ${budget.agent_remaining_usd.toFixed(2)} of $
          {budget.agent_cap_usd.toFixed(2)}. Both pools are shared by everyone using this app;
          your model budget is held against the second one until the run ends.
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
