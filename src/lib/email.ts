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
const FROM_NAME = process.env.MAIL_FROM_NAME || "Lead Agent";

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
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#8a8578;">Lead Agent</p>
<h1 style="margin:0 0 16px;font-size:19px;line-height:1.3;">${escapeHtml(title)}</h1>
${bodyHtml}
${
  ctaHref
    ? `<p style="margin:22px 0 0;"><a href="${escapeHtml(ctaHref)}" style="display:inline-block;padding:10px 18px;background:#2f5d8a;color:#ffffff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">${escapeHtml(ctaLabel ?? "Open")}</a></p>`
    : ""
}
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#8a8578;">You are receiving this because you started a run in Lead Agent.</p>
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
  targetLeads: number;
  evaluated: number;
  costUsd: number;
  durationMs: number | null;
  injectionAttempts: number;
};

export async function sendRunFinished(to: string, s: RunFinishedSummary): Promise<SendOutcome> {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const link = `${appUrl}/runs/${s.runId}`;
  const mins = s.durationMs ? `${(s.durationMs / 60000).toFixed(0)} min` : "—";

  const headline =
    s.status === "completed"
      ? `Your run found ${s.qualified} qualified lead${s.qualified === 1 ? "" : "s"}`
      : s.status === "needs_review"
        ? `Your run needs review — ${s.qualified} of ${s.targetLeads} qualified`
        : `Your run ${s.status}`;

  const rows: [string, string][] = [
    ["Qualified", `${s.qualified} of ${s.targetLeads}`],
    ["Companies evaluated", String(s.evaluated)],
    ["Model spend", `$${s.costUsd.toFixed(4)}`],
    ["Took", mins],
  ];
  if (s.injectionAttempts > 0) {
    rows.push(["Injection attempts", `${s.injectionAttempts} flagged and ignored`]);
  }

  const html = shell(
    headline,
    `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#57534a;">${escapeHtml(s.objective)}</p>
${s.statusReason ? `<p style="margin:0 0 14px;padding:10px 12px;background:#fdf4e6;border:1px solid #8a5a17;border-radius:8px;font-size:13px;color:#8a5a17;">${escapeHtml(s.statusReason)}</p>` : ""}
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;">
${rows.map(([k, v]) => `<tr><td style="padding:3px 16px 3px 0;color:#8a8578;">${escapeHtml(k)}</td><td style="padding:3px 0;font-weight:600;">${escapeHtml(v)}</td></tr>`).join("")}
</table>
<p style="margin:18px 0 0;font-size:13px;color:#8a8578;">Nothing has been sent to any company. The drafts are waiting for your review.</p>`,
    link,
    "Review the run",
  );

  const text = [
    headline,
    "",
    s.objective,
    s.statusReason ? `\n${s.statusReason}` : "",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "Nothing has been sent to any company. The drafts are waiting for your review.",
    "",
    link,
  ].join("\n");

  return send(to, headline, html, text);
}
