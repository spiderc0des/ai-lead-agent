import "server-only";
import nodemailer from "nodemailer";

/**
 * Outbound mail, for the one thing worth interrupting someone about: their run
 * has finished. A run takes twenty minutes or more, so nobody should have to
 * sit and watch the page.
 *
 * Gmail SMTP rather than an email API, for the same reason week 4 chose it: a
 * provider's sandbox only delivers to the account owner until a domain is
 * verified with DNS records, and Gmail sends from an address you already own
 * with no verification step. The cost is that the "from" address is always the
 * literal Gmail address, with only the display name ours.
 *
 * NOTE: this is notification mail to the run's own owner. It is NOT outreach —
 * the agent still has no way to contact a lead, and none of the drafted copy
 * is ever sent anywhere by this app.
 */

const USER = process.env.MAIL_USER;
const PASS = process.env.MAIL_APP_PASSWORD;
const FROM_NAME = process.env.MAIL_FROM_NAME || "Koya Lead Agent";

export const emailEnabled = Boolean(USER && PASS);

const transport = emailEnabled
  ? nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: USER, pass: PASS },
    })
  : null;

export type SendOutcome =
  | { sent: true }
  | { sent: false; reason: string };

function shell(title: string, bodyHtml: string, ctaHref?: string, ctaLabel?: string): string {
  // Inline styles only: every email client strips <style> blocks, and several
  // strip <head> entirely.
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#faf9f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#141413;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e4e1d9;border-radius:10px;" cellpadding="0" cellspacing="0">
<tr><td style="padding:24px 28px;">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#8a8578;">Koya Lead Agent</p>
<h1 style="margin:0 0 16px;font-size:19px;line-height:1.3;">${escapeHtml(title)}</h1>
${bodyHtml}
${
  ctaHref
    ? `<p style="margin:22px 0 0;"><a href="${escapeHtml(ctaHref)}" style="display:inline-block;padding:10px 18px;background:#2f5d8a;color:#ffffff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">${escapeHtml(ctaLabel ?? "Open")}</a></p>`
    : ""
}
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#8a8578;">You are receiving this because you started this run in Koya Lead Agent.</p>
</td></tr></table></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Both parts, always. The text part is what a screen reader reads, what a
 * watch notification shows, and a message with no text part scores measurably
 * worse with spam filters.
 */
async function send(to: string, subject: string, html: string, text: string): Promise<SendOutcome> {
  if (!transport) return { sent: false, reason: "MAIL_USER / MAIL_APP_PASSWORD are not set" };
  try {
    await transport.sendMail({ from: `"${FROM_NAME}" <${USER}>`, to, subject, html, text });
    return { sent: true };
  } catch (err) {
    // A notification must never take a run down with it.
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export type RunFinishedSummary = {
  runId: string;
  objective: string;
  status: string;
  statusReason: string | null;
  qualified: number;
  needsReview: number;
  targetLeads: number;
  evaluated: number;
  costUsd: number;
  durationMs: number | null;
  injectionAttempts: number;
  /** The owner's name, for the greeting. Falls back to no name. */
  recipientName?: string | null;
  /** Present when the run is waiting for the criteria to be approved. */
  icp?: IcpSummary | null;
  /** Present when the run stopped to ask. */
  questions?: string[];
};

export type IcpSummary = {
  target_company_type: string;
  geography: string[];
  headcount_range: string;
  hard_filters: string[];
  user_stated?: string[];
  assumptions?: string[];
};

const STATUS_LABEL: Record<string, string> = {
  completed: "Completed",
  needs_review: "Needs review",
  needs_clarification: "Waiting for your answer",
  awaiting_confirmation: "Waiting for your approval",
  failed: "Failed",
  cancelled: "Cancelled",
};

const muted = "margin:0 0 14px;font-size:14px;line-height:1.6;color:#57534a;";
const listHtml = (title: string, items: string[]) =>
  items.length
    ? `<p style="margin:14px 0 6px;font-size:13px;font-weight:600;color:#141413;">${escapeHtml(title)}</p>
<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.55;color:#141413;">${items.map((i) => `<li style="margin:0 0 4px;">${escapeHtml(i)}</li>`).join("")}</ul>`
    : "";

/**
 * One email per moment the owner needs to know about:
 *   awaiting_confirmation  the refined criteria are ready to review
 *   needs_clarification    the objective could not be searched; it asks
 *   completed / needs_review / failed / cancelled   the run has ended
 *
 * Each says what state the run is in, in words, and what — if anything — the
 * reader has to do next.
 */
export async function sendRunFinished(to: string, s: RunFinishedSummary): Promise<SendOutcome> {
  const { subject, html, text } = renderRunEmail(s);
  return send(to, subject, html, text);
}

/** The email for a run update, without sending it — also used to preview. */
export function renderRunEmail(s: RunFinishedSummary): { subject: string; html: string; text: string } {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const link = `${appUrl}/runs/${s.runId}`;
  const mins = s.durationMs ? `${Math.max(1, Math.round(s.durationMs / 60000))} min` : "—";
  const waiting = s.status === "needs_clarification" || s.status === "awaiting_confirmation";
  const greeting = s.recipientName?.trim() ? `Hi ${s.recipientName.trim().split(/\s+/)[0]},` : "Hi,";
  const statusLabel = STATUS_LABEL[s.status] ?? s.status.replace(/_/g, " ");

  const headline =
    s.status === "awaiting_confirmation"
      ? "Your refined ICP is ready for review"
      : s.status === "needs_clarification"
        ? "Your run has a question for you"
        : s.status === "completed"
          ? `Your run is complete: ${s.qualified} qualified lead${s.qualified === 1 ? "" : "s"}`
          : s.status === "needs_review"
            ? `Your run finished and needs review: ${s.qualified} of ${s.targetLeads} qualified`
            : s.status === "cancelled"
              ? "Your run was cancelled"
              : s.status === "failed"
                ? "Your run failed"
                : `Your run: ${statusLabel}`;

  const intro =
    s.status === "awaiting_confirmation"
      ? "The agent has turned your objective into search criteria. Nothing has been searched yet. Check them and approve, or give a corrected objective — the same run continues either way."
      : s.status === "needs_clarification"
        ? "The agent couldn't turn your objective into anything searchable, so it stopped before spending anything on search. Answer on the run page and it carries on."
        : s.status === "failed" || s.status === "cancelled"
          ? "Everything found up to that point is still stored. You can resume the run from where it stopped."
          : "Nothing has been sent to any company. The leads and drafts are waiting for your review.";

  const rows: [string, string][] = waiting
    ? [
        ["Status", statusLabel],
        ["Spent so far", `$${s.costUsd.toFixed(2)}`],
      ]
    : [
        ["Status", statusLabel],
        ["Qualified", `${s.qualified} of ${s.targetLeads}`],
        ["Needs review", String(s.needsReview)],
        ["Companies evaluated", String(s.evaluated)],
        ["Model spend", `$${s.costUsd.toFixed(2)}`],
        ["Took", mins],
      ];
  if (!waiting && s.injectionAttempts > 0) {
    rows.push(["Injection attempts", `${s.injectionAttempts} flagged and ignored`]);
  }

  const icp = s.status === "awaiting_confirmation" ? s.icp : null;
  const icpHtml = icp
    ? `<div style="margin:16px 0 0;padding:12px 14px;background:#faf9f5;border:1px solid #e4e1d9;border-radius:8px;">
<p style="margin:0 0 4px;font-size:14px;font-weight:600;">${escapeHtml(icp.target_company_type)}</p>
<p style="margin:0;font-size:13px;color:#57534a;">${escapeHtml(icp.geography.join(", "))} · ${escapeHtml(icp.headcount_range)}</p>
${listHtml("From your objective", icp.user_stated ?? [])}
${listHtml("Assumed by the agent — check these", icp.assumptions ?? [])}
${listHtml("Every lead must match", icp.hard_filters)}
</div>`
    : "";
  const questionsHtml =
    s.status === "needs_clarification" && s.questions?.length ? listHtml("It's asking", s.questions) : "";

  const html = shell(
    headline,
    `<p style="${muted}">${escapeHtml(greeting)}</p>
<p style="${muted}">${escapeHtml(intro)}</p>
<p style="margin:0 0 14px;padding:10px 12px;background:#faf9f5;border-left:3px solid #2f5d8a;font-size:14px;line-height:1.5;color:#141413;">${escapeHtml(s.objective)}</p>
${s.statusReason && !waiting ? `<p style="margin:0 0 14px;padding:10px 12px;background:#fdf4e6;border:1px solid #8a5a17;border-radius:8px;font-size:13px;color:#8a5a17;">${escapeHtml(s.statusReason)}</p>` : ""}
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;">
${rows.map(([k, v]) => `<tr><td style="padding:3px 16px 3px 0;color:#8a8578;">${escapeHtml(k)}</td><td style="padding:3px 0;font-weight:600;">${escapeHtml(v)}</td></tr>`).join("")}
</table>
${icpHtml}${questionsHtml}`,
    link,
    s.status === "awaiting_confirmation"
      ? "Review the criteria"
      : s.status === "needs_clarification"
        ? "Answer the question"
        : s.status === "failed" || s.status === "cancelled"
          ? "Open the run"
          : "Review the leads",
  );

  const textList = (title: string, items: string[] = []) =>
    items.length ? [`${title}:`, ...items.map((i) => `  - ${i}`), ""] : [];
  const text = [
    greeting,
    "",
    headline,
    "",
    intro,
    "",
    `Objective: ${s.objective}`,
    s.statusReason && !waiting ? `\n${s.statusReason}` : "",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    ...(icp
      ? [
          `${icp.target_company_type} — ${icp.geography.join(", ")} · ${icp.headcount_range}`,
          "",
          ...textList("From your objective", icp.user_stated),
          ...textList("Assumed by the agent — check these", icp.assumptions),
          ...textList("Every lead must match", icp.hard_filters),
        ]
      : []),
    ...(s.status === "needs_clarification" ? textList("It's asking", s.questions) : []),
    link,
  ].join("\n");

  return { subject: headline, html, text };
}
