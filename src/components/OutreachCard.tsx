"use client";
import { CopyButton } from "@/components/CopyButton";

export type Draft = {
  id: string;
  lead_id: string;
  channel: string;
  step_number: number;
  subject: string | null;
  body: string;
  personalization_note: string | null;
  evidence_url: string | null;
};

/**
 * One lead's outreach, laid out to be reviewed and then pasted.
 *
 * Every piece has its own copy button, plus one for the whole sequence: the
 * useful unit is sometimes a single email and sometimes the lot.
 */
export function OutreachCard({
  companyName,
  companyDomain,
  drafts,
}: {
  companyName: string;
  companyDomain: string;
  drafts: Draft[];
}) {
  const emails = drafts
    .filter((d) => d.channel === "email")
    .sort((a, b) => a.step_number - b.step_number);
  const linkedin = drafts.find((d) => d.channel === "linkedin");

  const whole = [
    ...emails.map((e) => `--- Email ${e.step_number} ---\nSubject: ${e.subject ?? ""}\n\n${e.body}`),
    linkedin ? `--- LinkedIn ---\n\n${linkedin.body}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{companyName}</h3>
          <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
            {companyDomain}
          </p>
        </div>
        <CopyButton value={whole} label="Copy all" />
      </div>

      {emails.length === 0 && (
        <p className="mt-3 text-sm" style={{ color: "var(--ink-faint)" }}>
          No drafts written for this lead.
        </p>
      )}

      <ol className="mt-4 space-y-3">
        {emails.map((e) => (
          <li key={e.id} className="rounded-[var(--radius)] border p-3" style={{ borderColor: "var(--rule)" }}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
                  Email {e.step_number}
                </p>
                <p className="text-sm font-medium">{e.subject}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <CopyButton value={e.subject ?? ""} label="Subject" />
                <CopyButton value={e.body} label="Body" />
              </div>
            </div>
            <p className="preformatted mt-2">{e.body}</p>
            <p className="hint">
              {e.personalization_note}
              {e.evidence_url && (
                <>
                  {" · "}
                  <a href={e.evidence_url} target="_blank" rel="noreferrer noopener" style={{ color: "var(--accent)" }}>
                    evidence
                  </a>
                </>
              )}
            </p>
          </li>
        ))}
      </ol>

      {linkedin && (
        <div className="mt-3 rounded-[var(--radius)] border p-3" style={{ borderColor: "var(--rule)" }}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
              LinkedIn message
            </p>
            <CopyButton value={linkedin.body} />
          </div>
          <p className="preformatted mt-1.5">{linkedin.body}</p>
        </div>
      )}
    </div>
  );
}
