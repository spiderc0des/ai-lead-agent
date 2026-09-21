"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Budget = {
  apify_cap_usd: number;
  apify_spent_usd: number;
  apify_reserved_usd: number;
  agent_cap_usd: number;
  agent_spent_usd: number;
  agent_reserved_usd: number;
  runs_paused: boolean;
};

export function AdminPanel({ budget }: { budget: Budget }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [apifyCap, setApifyCap] = useState(budget.apify_cap_usd);
  const [agentCap, setAgentCap] = useState(budget.agent_cap_usd);
  const [busy, setBusy] = useState(false);

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
      <section className="rounded-lg border border-neutral-200 p-4">
        <h2 className="text-sm font-semibold">Shared budget</h2>
        <p className="mt-1 text-xs text-neutral-500">
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
          <label className="text-xs text-neutral-600">
            Apify cap ($)
            <input
              type="number"
              step="0.5"
              value={apifyCap}
              onChange={(e) => setApifyCap(Number(e.target.value))}
              className="mt-1 block w-28 rounded border border-neutral-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-neutral-600">
            Model cap ($)
            <input
              type="number"
              step="1"
              value={agentCap}
              onChange={(e) => setAgentCap(Number(e.target.value))}
              className="mt-1 block w-28 rounded border border-neutral-300 px-2 py-1 text-sm"
            />
          </label>
          <button
            disabled={busy}
            onClick={() =>
              post("/api/admin/budget", { apify_cap_usd: apifyCap, agent_cap_usd: agentCap })
            }
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Save caps
          </button>
          <button
            disabled={busy}
            onClick={() => post("/api/admin/budget", { runs_paused: !budget.runs_paused })}
            className={`rounded-md px-3 py-1.5 text-sm ${
              budget.runs_paused
                ? "bg-emerald-700 text-white"
                : "border border-neutral-300 text-neutral-800"
            } disabled:opacity-50`}
          >
            {budget.runs_paused ? "Resume new runs" : "Pause new runs"}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 p-4">
        <h2 className="text-sm font-semibold">Invite a user</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Signup is closed. An address only gets a sign-in link once it has an account, and this is
          the only way to create one.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            className="w-64 rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
          <button
            disabled={busy || !email.includes("@")}
            onClick={() => post("/api/admin/invite", { email })}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Send invite
          </button>
        </div>
      </section>

      {note && (
        <p className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">{note}</p>
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
    <div className="rounded border border-neutral-200 p-3">
      <p className="text-xs text-neutral-500">{title}</p>
      <p className="mt-1 text-lg font-medium tabular-nums">
        ${left.toFixed(4)} <span className="text-sm font-normal text-neutral-400">left</span>
      </p>
      <div className="mt-2 h-1 w-full rounded bg-neutral-100">
        <div
          className={`h-1 rounded ${pct > 90 ? "bg-amber-500" : "bg-neutral-900"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-neutral-500">
        spent ${spent.toFixed(4)} · reserved ${reserved.toFixed(4)} · cap ${cap.toFixed(2)}
      </p>
    </div>
  );
}
