"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LIMITS, type RunLimits } from "@/lib/schemas";
import { leadCountFromObjective } from "@/lib/objective";

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
    help:
      "Pages that may be read. Follows Candidates unless you change it, so every discovered " +
      "company's homepage is read; set it higher to leave room for about, pricing and careers pages.",
    stop: "soft",
  },
  {
    key: "max_leads",
    label: "Qualified leads",
    help:
      "How many may be saved as qualified. Filled in from your objective (\"find 10…\") " +
      "unless you change it — and if the two disagree, this field wins. Rejections are unlimited.",
    stop: "soft",
  },
  {
    key: "max_budget_usd",
    label: "Model budget ($)",
    help:
      "Ceiling for this run, reserved from the shared pool while it runs. Research closes at " +
      "about half of it so the rest pays for drafting and finishing.",
    stop: "hard",
  },
] as const;

export function NewRunForm({
  activeRuns,
  maxRunsPerUser,
}: {
  activeRuns: number;
  maxRunsPerUser: number;
}) {
  const hasActiveRun = activeRuns >= maxRunsPerUser;
  const router = useRouter();
  const [objective, setObjective] = useState("");
  const [limits, setLimits] = useState<RunLimits>(DEFAULT_LIMITS);
  // A field follows its source (candidates -> scrapes, objective -> leads)
  // until the person edits it; after that their number stands.
  const [touched, setTouched] = useState<{ max_scrapes?: boolean; max_leads?: boolean }>({});
  const askedFor = leadCountFromObjective(objective);
  const leadsDisagree = askedFor !== null && askedFor !== limits.max_leads;

  function updateObjective(next: string) {
    setObjective(next);
    const n = leadCountFromObjective(next);
    if (n !== null && !touched.max_leads) {
      setLimits((l) => ({ ...l, max_leads: Math.min(50, n) }));
    }
  }

  function updateLimit(key: keyof RunLimits, value: number) {
    setLimits((l) => {
      const next = { ...l, [key]: value };
      if (key === "max_candidates" && !touched.max_scrapes) next.max_scrapes = Math.min(200, value);
      return next;
    });
    if (key === "max_scrapes" || key === "max_leads") setTouched((t) => ({ ...t, [key]: true }));
  }
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
    <form onSubmit={start} className="card">
      <h2 className="text-sm font-semibold">New run</h2>
      <p className="hint">
        Describe who you want to reach. The agent refines this into ICP criteria before it
        searches.
      </p>

      <textarea
        value={objective}
        onChange={(e) => updateObjective(e.target.value)}
        rows={3}
        required
        minLength={10}
        placeholder={EXAMPLE}
        className="field mt-4"
      />
      <button
        type="button"
        onClick={() => updateObjective(EXAMPLE)}
        className="btn btn-ghost btn-sm mt-1 px-0"
      >
        use the example objective
      </button>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setShowLimits((s) => !s)}
          className="btn btn-ghost btn-sm px-0"
        >
          {showLimits ? "hide limits" : "adjust limits"}
        </button>

        {showLimits && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="col-span-2 flex items-start gap-2 text-xs sm:col-span-3">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={limits.require_icp_confirmation}
                onChange={(e) =>
                  setLimits({ ...limits, require_icp_confirmation: e.target.checked })
                }
              />
              <span>
                <span className="label mb-0">Show me the criteria before searching</span>
                <span className="hint block">
                  The agent stops after writing the ICP and waits for your approval. That pass
                  costs about $0.05; a full run costs $0.70 to $1.20, so it is cheap insurance
                  against spending the latter on a misreading.
                </span>
              </span>
            </label>

            {LIMIT_FIELDS.map(({ key, label, help, stop }) => (
              <label key={key} className="text-xs">
                <span className="label mb-0">{label}</span>
                <input
                  type="number"
                  step={key === "max_budget_usd" ? "0.25" : "1"}
                  value={limits[key]}
                  onChange={(e) => updateLimit(key, Number(e.target.value))}
                  className="field mt-1"
                />
                <span className="hint block">
                  {help}{" "}
                  <span className={stop === "hard" ? "font-medium" : ""} style={stop === "hard" ? { color: "var(--warning)" } : undefined}>
                    {stop === "hard" ? "Hits it and the run is cut off." : "Hits it and the agent adapts."}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      {leadsDisagree && (
        <p className="panel panel-warning mt-4">
          Your objective asks for {askedFor}, but Qualified leads is set to {limits.max_leads}.
          The run will stop at {limits.max_leads} — change the field if you meant {askedFor}.
        </p>
      )}

      {budget && (
        <p className="hint mt-4">
          Shared budget left — discovery ${budget.apify_remaining_usd.toFixed(2)} of $
          {budget.apify_cap_usd.toFixed(2)} · model ${budget.agent_remaining_usd.toFixed(2)} of $
          {budget.agent_cap_usd.toFixed(2)}. Both pools are shared by everyone using this app;
          your model budget is held against the second one until the run ends.
        </p>
      )}

      {hasActiveRun && (
        <p className="panel panel-warning mt-3">
          {maxRunsPerUser === 1
            ? "You already have a run in progress. One at a time — the workers are shared."
            : `You have ${activeRuns} runs in progress, the most allowed per person. Wait for one to finish.`}
        </p>
      )}
      {budget?.runs_paused && (
        <p className="panel panel-warning mt-3">
          New runs are paused by an administrator.
        </p>
      )}
      {error && (
        <p className="panel panel-danger mt-3">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || blocked || objective.trim().length < 10}
        className="btn btn-primary mt-4"
      >
        {busy ? "Starting…" : "Start run"}
      </button>
    </form>
  );
}
