import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Icp } from "@/lib/schemas";
import { effectiveObjective } from "@/lib/objective-server";
import { leadWorkbook, type WorkbookLead } from "@/lib/lead-workbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Lead = {
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

type Draft = {
  lead_id: string;
  channel: string;
  step_number: number;
  subject: string | null;
  body: string;
  personalization_note: string | null;
  evidence_url: string | null;
};

/**
 * Deliverables from one place:
 *   ?format=md    the outreach sample pack a reviewer reads
 *   ?format=xlsx  the lead list: a Qualified sheet and a Needs review sheet
 *   ?format=csv   the qualified leads alone, for tools that only take CSV
 *
 * Needs-review leads get their own sheet rather than a status column because
 * they are a to-do list for a person, not part of the list: the quality guide
 * says they never count as qualified, and mixing them in invites someone to
 * sort by company and mail all of them.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const format = new URL(request.url).searchParams.get("format") ?? "md";

    const { data: run } = await supabaseAdmin()
      .from("runs")
      .select("id, user_id, objective, icp, status, status_reason, summary, total_cost_usd, created_at")
      .eq("id", id)
      .maybeSingle();

    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (run.user_id !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: "Not your run" }, { status: 403 });
    }

    const { data: leadRows } = await supabaseAdmin()
      .from("leads")
      // "*" so review columns (0010_reviews.sql) come through when they exist.
      .select("*")
      .eq("run_id", id)
      .in("qualification_status", ["qualified", "needs_review"])
      .order("company_name");

    const allLeads = (leadRows ?? []) as Lead[];
    const leads = allLeads.filter((l) => l.qualification_status === "qualified");
    const needsReview = allLeads.filter((l) => l.qualification_status === "needs_review");

    if (format === "xlsx") {
      const body = await leadWorkbook(leads as WorkbookLead[], needsReview as WorkbookLead[]);
      return new NextResponse(body, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="leads-${id.slice(0, 8)}.xlsx"`,
        },
      });
    }

    if (format === "csv") {
      const header = [
        "company_name",
        "company_domain",
        "qualification_status",
        "confidence",
        "fit_reasons",
        "concerns",
        "source_urls",
        "source_summary",
      ];
      const rows = leads.map((l) =>
        [
          l.company_name,
          l.company_domain,
          l.qualification_status,
          String(l.confidence),
          (l.fit_reasons ?? []).join(" | "),
          (l.concerns ?? []).join(" | "),
          (l.source_urls ?? []).join(" | "),
          l.source_summary ?? "",
        ]
          .map(csvCell)
          .join(","),
      );

      return new NextResponse([header.join(","), ...rows].join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="qualified-leads-${id.slice(0, 8)}.csv"`,
        },
      });
    }

    const { data: draftRows } = await supabaseAdmin()
      .from("outreach_drafts")
      .select("lead_id, channel, step_number, subject, body, personalization_note, evidence_url")
      .eq("run_id", id)
      .order("step_number");

    const drafts = (draftRows ?? []) as Draft[];
    const byLead = new Map<string, Draft[]>();
    for (const d of drafts) {
      const list = byLead.get(d.lead_id) ?? [];
      list.push(d);
      byLead.set(d.lead_id, list);
    }

    const icp = run.icp as Icp | null;
    const objective = await effectiveObjective(supabaseAdmin(), run);
    const out: string[] = [
      `# Outreach sample pack`,
      ``,
      `**Run:** \`${run.id}\`  `,
      `**Generated:** ${new Date().toISOString()}  `,
      `**Status:** ${run.status}${run.status_reason ? ` — ${run.status_reason}` : ""}  `,
      `**Qualified leads:** ${leads.length}  `,
      `**Estimated model cost:** $${Number(run.total_cost_usd ?? 0).toFixed(4)}`,
      ``,
      `## Qualification objective`,
      ``,
      `> ${objective.replace(/\n/g, "\n> ")}`,
      ``,
    ];

    if (icp) {
      out.push(
        `## Refined ICP criteria`,
        ``,
        `| Field | Value |`,
        `| --- | --- |`,
        `| Target company type | ${icp.target_company_type} |`,
        `| Industries | ${icp.industries.join(", ")} |`,
        `| Geography | ${icp.geography.join(", ")} |`,
        `| Headcount | ${icp.headcount_range} |`,
        `| Buyer persona | ${icp.buyer_persona} |`,
        `| Business problem | ${icp.business_problem} |`,
        ``,
        `**From the objective**`,
        ``,
        ...(icp.user_stated?.length
          ? icp.user_stated.map((f) => `- ${f}`)
          : ["- (nothing explicit — the criteria below were inferred)"]),
        ``,
        `**Assumed by the agent**`,
        ``,
        ...(icp.assumptions?.length ? icp.assumptions.map((f) => `- ${f}`) : ["- (none)"]),
        ``,
        `**Hard filters**`,
        ``,
        ...icp.hard_filters.map((f) => `- ${f}`),
        ``,
        `**Soft preferences**`,
        ``,
        ...(icp.soft_preferences.length ? icp.soft_preferences.map((f) => `- ${f}`) : ["- (none)"]),
        ``,
        `**Disqualifiers**`,
        ``,
        ...(icp.disqualifiers.length ? icp.disqualifiers.map((f) => `- ${f}`) : ["- (none)"]),
        ``,
      );
    }

    if (run.summary) out.push(`## Agent summary`, ``, run.summary, ``);

    out.push(`---`, ``, `## Qualified leads`, ``);

    for (const [i, lead] of leads.entries()) {
      const leadDrafts = (byLead.get(lead.id) ?? []).slice().sort((a, b) => {
        if (a.channel !== b.channel) return a.channel === "email" ? -1 : 1;
        return a.step_number - b.step_number;
      });

      out.push(
        `### ${i + 1}. ${lead.company_name} — ${lead.company_domain}`,
        ``,
        `**Confidence:** ${lead.confidence}`,
        ``,
        `**Source context**`,
        ``,
        lead.source_summary ?? "_(none recorded)_",
        ``,
        `**Sources**`,
        ``,
        ...(lead.source_urls ?? []).map((u) => `- ${u}`),
        ``,
        `**Why it fits**`,
        ``,
        ...(lead.fit_reasons ?? []).map((r) => `- ${r}`),
        ``,
      );

      if (lead.concerns?.length) {
        out.push(`**Concerns**`, ``, ...lead.concerns.map((c) => `- ${c}`), ``);
      }

      const emails = leadDrafts.filter((d) => d.channel === "email");
      if (emails.length) {
        out.push(`**Cold email sequence**`, ``);
        for (const e of emails) {
          out.push(
            `*Step ${e.step_number}* — subject: **${e.subject ?? "(none)"}**`,
            ``,
            "```",
            e.body,
            "```",
            ``,
            `Personalisation: ${e.personalization_note ?? "—"}  `,
            `Evidence: ${e.evidence_url ?? "—"}`,
            ``,
          );
        }
      }

      const li = leadDrafts.find((d) => d.channel === "linkedin");
      if (li) {
        out.push(`**LinkedIn message**`, ``, "```", li.body, "```", ``);
        if (li.personalization_note) out.push(`Personalisation: ${li.personalization_note}`, ``);
      }

      out.push(`---`, ``);
    }

    out.push(
      ``,
      `_These are drafts for human review. No outreach was sent, no personal email addresses were`,
      `collected, and no email deliverability was checked._`,
      ``,
    );

    return new NextResponse(out.join("\n"), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `inline; filename="outreach-pack-${id.slice(0, 8)}.md"`,
      },
    });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function csvCell(value: string): string {
  const v = value ?? "";
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
