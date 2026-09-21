import "./env";
import { createClient } from "@supabase/supabase-js";

const RUN = process.argv[2];
const db = createClient(
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const line = (s = "") => console.log(s);
const h = (s: string) => { line(); line(`=== ${s} ${"=".repeat(Math.max(0, 62 - s.length))}`); };

async function main() {
  const { data: run } = await db.from("runs").select("*").eq("id", RUN).single();
  if (!run) throw new Error("run not found");

  h("RUN");
  line(`status      : ${run.status}${run.status_reason ? ` — ${run.status_reason}` : ""}`);
  line(`model       : ${run.model}`);
  line(`turns       : ${run.num_turns ?? "(null)"} / ${run.limits.max_turns}`);
  line(`cost        : $${Number(run.total_cost_usd ?? 0).toFixed(4)} / $${run.limits.max_budget_usd}`);
  line(`duration    : ${run.duration_ms ? (run.duration_ms / 60000).toFixed(1) + " min" : "(null)"}`);
  line(`started     : ${run.started_at}`);
  line(`finished    : ${run.finished_at ?? "(still running)"}`);
  if (run.usage) line(`usage       : ${JSON.stringify(run.usage)}`);
  if (run.model_usage) line(`model_usage : ${JSON.stringify(run.model_usage)}`);

  h("FUNNEL");
  const count = async (t: string, extra?: [string, string]) => {
    let q = db.from(t).select("id", { count: "exact", head: true }).eq("run_id", RUN);
    if (extra) q = q.eq(extra[0], extra[1]);
    return (await q).count ?? 0;
  };
  const cands = await count("candidates");
  const pages = await count("page_sources");
  const qual = await count("leads", ["qualification_status", "qualified"]);
  const nq = await count("leads", ["qualification_status", "not_qualified"]);
  const nr = await count("leads", ["qualification_status", "needs_review"]);
  line(`candidates discovered : ${cands} / ${run.limits.max_candidates}`);
  line(`pages scraped         : ${pages} / ${run.limits.max_scrapes}`);
  line(`leads evaluated       : ${qual + nq + nr}  (qualified ${qual}, not_qualified ${nq}, needs_review ${nr})`);
  line(`conversion            : ${cands ? ((qual / cands) * 100).toFixed(1) : "0"}% of candidates qualified`);
  line(`scrapes per evaluated : ${(qual + nq + nr) ? (pages / (qual + nq + nr)).toFixed(1) : "—"}`);

  h("TOOL CALLS");
  const { data: tc } = await db.from("tool_calls").select("*").eq("run_id", RUN).order("created_at");
  const calls = tc ?? [];
  const byTool = new Map<string, Record<string, number>>();
  for (const c of calls) {
    const row = byTool.get(c.tool_name) ?? {};
    row[c.status] = (row[c.status] ?? 0) + 1;
    byTool.set(c.tool_name, row);
  }
  line(`total: ${calls.length}`);
  for (const [tool, st] of byTool) {
    line(`  ${tool.padEnd(22)} ${Object.entries(st).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  }
  const bad = calls.filter((c) => c.status !== "success");
  if (bad.length) {
    h("NON-SUCCESS CALLS");
    for (const c of bad) line(`  [${c.status}] ${c.tool_name}: ${String(c.error_message ?? "").slice(0, 190)}`);
  }

  h("TIMING");
  const durs = calls.filter((c) => c.duration_ms).map((c) => ({ t: c.tool_name, ms: c.duration_ms }));
  const agg = new Map<string, number[]>();
  for (const d of durs) agg.set(d.t, [...(agg.get(d.t) ?? []), d.ms]);
  for (const [t, ms] of agg) {
    const sum = ms.reduce((a, b) => a + b, 0);
    line(`  ${t.padEnd(22)} n=${String(ms.length).padStart(3)}  total=${(sum / 1000).toFixed(0)}s  avg=${(sum / ms.length / 1000).toFixed(1)}s`);
  }
  const wall = run.started_at && run.finished_at
    ? (new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 60000 : null;
  if (wall) line(`  wall clock: ${wall.toFixed(1)} min of ${(run.limits.wall_clock_ms / 60000)} allowed`);

  h("INJECTION");
  const { data: flagged } = await db.from("page_sources")
    .select("url, injection_flags, scraper").eq("run_id", RUN);
  const hits = (flagged ?? []).filter((p) => p.injection_flags?.length);
  line(`pages with attempts: ${hits.length} of ${flagged?.length ?? 0}`);
  for (const p of hits) line(`  ${p.url}\n    ${p.injection_flags.join(", ")}`);
  const scrapers = new Map<string, number>();
  for (const p of flagged ?? []) scrapers.set(p.scraper, (scrapers.get(p.scraper) ?? 0) + 1);
  line(`scraper used: ${[...scrapers].map(([k, v]) => `${k}=${v}`).join(", ")}`);

  h("QUALIFIED LEADS");
  const { data: leads } = await db.from("leads").select("*").eq("run_id", RUN)
    .eq("qualification_status", "qualified").order("company_name");
  for (const l of leads ?? []) {
    line(`  ${l.company_name} (${l.company_domain})  conf=${l.confidence}  sources=${l.source_urls.length}`);
    for (const r of l.fit_reasons.slice(0, 2)) line(`     + ${String(r).slice(0, 150)}`);
    for (const c of l.concerns.slice(0, 2)) line(`     ! ${String(c).slice(0, 150)}`);
  }

  h("NEEDS REVIEW — why");
  const { data: rev } = await db.from("leads").select("company_domain, confidence, concerns")
    .eq("run_id", RUN).eq("qualification_status", "needs_review").order("confidence", { ascending: false });
  for (const l of rev ?? []) line(`  ${l.company_domain.padEnd(26)} conf=${l.confidence}  ${String(l.concerns?.[0] ?? "").slice(0, 110)}`);

  h("OUTREACH DRAFTS + PROVENANCE");
  const { data: drafts } = await db.from("outreach_drafts").select("*").eq("run_id", RUN);
  const { data: allLeads } = await db.from("leads").select("id, company_domain, source_urls").eq("run_id", RUN);
  const srcById = new Map((allLeads ?? []).map((l) => [l.id, l]));
  line(`drafts: ${drafts?.length ?? 0}  (expect 4 per qualified lead: 3 email + 1 linkedin)`);
  let badEvidence = 0, withEmail = 0;
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  for (const d of drafts ?? []) {
    const lead = srcById.get(d.lead_id);
    if (d.channel === "email" && d.evidence_url && !lead?.source_urls?.includes(d.evidence_url)) badEvidence++;
    if (EMAIL.test(`${d.subject ?? ""} ${d.body}`)) withEmail++;
  }
  line(`evidence_url not in the lead's sources : ${badEvidence}   (must be 0)`);
  line(`drafts containing an email address     : ${withEmail}   (must be 0)`);

  h("LEDGER");
  const { data: led } = await db.from("budget_ledger").select("*").eq("run_id", RUN).order("created_at");
  for (const l of led ?? []) line(`  ${l.kind.padEnd(6)} ${l.phase.padEnd(8)} $${Number(l.amount_usd).toFixed(4)}  ${l.note ?? ""}`);
  const apifySpend = (led ?? []).filter((l) => l.kind === "apify" && l.phase === "settle")
    .reduce((a, b) => a + Number(b.amount_usd), 0);
  line(`  apify actually spent: $${apifySpend.toFixed(4)}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
