"use client";

import { useState } from "react";
import { StatusPill } from "@/components/StatusPill";
import { OutreachCard, type Draft } from "@/components/OutreachCard";

export type Lead = {
  id: string;
  company_name: string;
  company_domain: string;
  qualification_status: string;
  confidence: number;
  fit_reasons: string[];
  concerns: string[];
  source_urls: string[];
  source_summary: string | null;
};

export type SourceRef = { url: string; injection_flags: string[] };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "qualified", label: "Qualified" },
  { key: "needs_review", label: "Needs review" },
  { key: "not_qualified", label: "Not qualified" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

/**
 * Every company the qualification stage ran for, not just the ones that passed.
 *
 * The rejections are part of the deliverable — they are what shows the list was
 * filtered rather than merely collected — so they belong in the same place,
 * behind a filter, rather than in a separate table further down the page.
 *
 * Each row shows only what distinguishes it: who, how confident, and the single
 * most load-bearing sentence. Everything else is one click away, because a dozen
 * fully-expanded leads is several screens of prose nobody reads top to bottom.
 */
export function LeadList({
  leads,
  drafts,
  sources,
}: {
  leads: Lead[];
  drafts: Draft[];
  sources: SourceRef[];
}) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const draftsByLead = new Map<string, Draft[]>();
  for (const d of drafts) draftsByLead.set(d.lead_id, [...(draftsByLead.get(d.lead_id) ?? []), d]);

  const count = (k: FilterKey) =>
    k === "all" ? leads.length : leads.filter((l) => l.qualification_status === k).length;
  const shown = filter === "all" ? leads : leads.filter((l) => l.qualification_status === filter);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`btn btn-sm ${filter === f.key ? "btn-primary" : ""}`}
          >
            {f.label}
            <span style={{ opacity: 0.7 }}>{count(f.key)}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="mt-4 text-sm" style={{ color: "var(--ink-faint)" }}>
          {leads.length === 0
            ? "No company has been evaluated yet."
            : `Nothing in this run was marked ${filter.replace("_", " ")}.`}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {shown.map((lead) => {
            const open = openId === lead.id;
            // The one sentence that explains the decision: why it passed, or
            // what stopped it.
            const headline =
              lead.qualification_status === "qualified"
                ? lead.fit_reasons?.[0]
                : (lead.concerns?.[0] ?? lead.fit_reasons?.[0]);

            return (
              <li key={lead.id} className="overflow-hidden rounded-[var(--radius)] border"
                  style={{ borderColor: "var(--rule)", background: "var(--card)" }}>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : lead.id)}
                  aria-expanded={open}
                  className="flex w-full items-start gap-3 p-3 text-left"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                       className="mt-1 shrink-0"
                       style={{ color: "var(--ink-faint)", transform: open ? "rotate(90deg)" : "none", transition: "transform .12s" }}>
                    <path d="M6 3l5 5-5 5" />
                  </svg>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold">{lead.company_name}</span>
                      <span className="text-xs" style={{ color: "var(--ink-faint)" }}>{lead.company_domain}</span>
                    </div>
                    {headline && (
                      <p className="mt-1 line-clamp-2 text-xs" style={{ color: "var(--ink-soft)" }}>{headline}</p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className="chip tabular-nums">{lead.confidence?.toFixed(2)}</span>
                    <StatusPill status={lead.qualification_status} />
                  </div>
                </button>

                {open && (
                  <div className="border-t px-4 py-4" style={{ borderColor: "var(--rule)" }}>
                    <LeadDetail lead={lead} sources={sources} />
                    {lead.qualification_status === "qualified" && (
                      <div className="mt-3">
                        <OutreachCard
                          companyName={lead.company_name}
                          companyDomain={lead.company_domain}
                          drafts={draftsByLead.get(lead.id) ?? []}
                        />
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function LeadDetail({ lead, sources }: { lead: Lead; sources: SourceRef[] }) {
  const mine = sources.filter((s) => lead.source_urls?.includes(s.url));
  return (
    <div className="space-y-3 text-sm">
      {lead.source_summary && (
        <div>
          <p className="label">Source context</p>
          <p>{lead.source_summary}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {lead.fit_reasons?.length > 0 && (
          <div>
            <p className="label">Why it fits</p>
            <ul className="list-disc pl-5">{lead.fit_reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        )}
        {lead.concerns?.length > 0 && (
          <div>
            <p className="label">Concerns</p>
            <ul className="list-disc pl-5" style={{ color: "var(--ink-soft)" }}>
              {lead.concerns.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>
        )}
      </div>

      <div>
        <p className="label">Sources</p>
        <ul>
          {lead.source_urls?.map((u) => {
            const src = mine.find((s) => s.url === u);
            return (
              <li key={u}>
                <a href={u} target="_blank" rel="noreferrer noopener" style={{ color: "var(--accent)" }}>{u}</a>
                {src?.injection_flags?.length ? (
                  <span className="ml-2 text-xs" style={{ color: "var(--danger)" }}>(injection attempt flagged)</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
