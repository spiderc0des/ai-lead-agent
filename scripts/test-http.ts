/**
 * End-to-end tests for the routes a person uses after a run: reviewing
 * needs-review leads and runs, marking qualified leads processed, the team
 * skip list, and the spreadsheet export — over real HTTP, with a real session.
 *
 *   QUEUE_WORKER=off PORT=3100 npm run start     # a web-only server
 *   npm run test:http                             # against http://localhost:3100
 *
 * QUEUE_WORKER=off matters: the server shares the production database, and a
 * second worker would race the deployed one for queued runs.
 *
 * Signs in as the first admin by minting a magic-link token server-side and
 * verifying it — no email is sent. Creates its own fixture run and deletes it
 * afterwards. Where a migration has not been applied, the affected checks say
 * so and are skipped rather than reported as failures.
 */
import "./env";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { loadSkipDomains, parseDomainList } from "@/lib/suppression";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3100";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let passed = 0;
let failed = 0;
const skipped: string[] = [];
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 300));
  }
}
const skip = (why: string) => {
  skipped.push(why);
  console.log(`  skip ${why}`);
};

/** @supabase/ssr's cookie format: "base64-" + base64url(session JSON), chunked. */
function sessionCookie(session: unknown): string {
  const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
  const key = `sb-${ref}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const CHUNK = 3180;
  if (value.length <= CHUNK) return `${key}=${value}`;
  const parts: string[] = [];
  for (let i = 0; i * CHUNK < value.length; i++) parts.push(`${key}.${i}=${value.slice(i * CHUNK, (i + 1) * CHUNK)}`);
  return parts.join("; ");
}

async function main() {
  const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });

  const { data: admin } = await db.from("profiles").select("id, email").eq("role", "admin").limit(1).single();
  if (!admin) throw new Error("No admin profile — run seed:admin first.");

  // ---- sign in, without sending anything
  const { data: link, error: linkError } = await db.auth.admin.generateLink({ type: "magiclink", email: admin.email });
  if (linkError || !link.properties) throw new Error(`generateLink: ${linkError?.message}`);
  const { data: auth, error: otpError } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (otpError || !auth.session) throw new Error(`verifyOtp: ${otpError?.message}`);
  const cookie = sessionCookie(auth.session);

  const call = async (method: string, path: string, body?: unknown, withAuth = true) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(withAuth ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json as Record<string, unknown> };
  };

  // ---- fixtures: a needs_review run with one lead of each kind
  const { data: run, error: runError } = await db
    .from("runs")
    .insert({
      user_id: admin.id,
      objective: "TEST RUN — review/processed/skip-list HTTP tests, safe to delete",
      limits: { max_candidates: 5, max_scrapes: 5, max_leads: 2, max_turns: 40, max_budget_usd: 0.1, wall_clock_ms: 60000 },
      status: "needs_review",
      status_reason: "Server verification found: only 1 of 2 qualified leads were found.",
    })
    .select("id")
    .single();
  if (runError || !run) throw new Error(`fixture run: ${runError?.message}`);
  const lead = (name: string, domain: string, status: string) => ({
    run_id: run.id,
    user_id: admin.id,
    company_name: name,
    company_domain: domain,
    qualification_status: status,
    confidence: 0.5,
    fit_reasons: ["test"],
    concerns: ["test"],
    source_urls: [`https://${domain}/`],
    source_summary: "Fixture lead for the HTTP tests.",
  });
  const { data: leads, error: leadError } = await db
    .from("leads")
    .insert([
      lead("Review Me Co", "review-me-test.example", "needs_review"),
      lead("Qualified Co", "qualified-test.example", "qualified"),
    ])
    .select("id, qualification_status");
  if (leadError || !leads) throw new Error(`fixture leads: ${leadError?.message}`);
  const reviewLead = leads.find((l) => l.qualification_status === "needs_review")!.id;
  const qualifiedLead = leads.find((l) => l.qualification_status === "qualified")!.id;

  try {
    console.log("\n== access ==");
    {
      const r = await call("POST", `/api/runs/${run.id}/review`, { decision: "good" }, false);
      check("signed-out review is refused", r.status === 401, r);
    }

    console.log("\n== reviewing a needs-review lead ==");
    {
      const r = await call("POST", `/api/runs/${run.id}/leads/${reviewLead}/review`, {
        decision: "good",
        note: "LinkedIn shows 11-50 employees.",
      });
      if (r.status === 409 && /0010_reviews/.test(String(r.body.error))) {
        skip("lead and run reviews: apply 0010_reviews.sql");
      } else {
        check("marks it reviewed: good", r.status === 200, r);
        const { data: row } = await db.from("leads").select("*").eq("id", reviewLead).single();
        check("  decision, note and reviewer are stored", row?.review_decision === "good" && row?.review_note === "LinkedIn shows 11-50 employees." && Boolean(row?.reviewed_by_name), row);
        check("  the agent's own status is untouched", row?.qualification_status === "needs_review");

        const change = await call("POST", `/api/runs/${run.id}/leads/${reviewLead}/review`, { decision: "not_good", note: "Actually 400 staff." });
        const { data: changed } = await db.from("leads").select("review_decision, review_note").eq("id", reviewLead).single();
        check("a verdict can be changed", change.status === 200 && changed?.review_decision === "not_good", changed);

        const undo = await call("POST", `/api/runs/${run.id}/leads/${reviewLead}/review`, { decision: null });
        const { data: undone } = await db.from("leads").select("review_decision, reviewed_at").eq("id", reviewLead).single();
        check("and withdrawn", undo.status === 200 && undone?.review_decision === null && undone?.reviewed_at === null, undone);

        const wrong = await call("POST", `/api/runs/${run.id}/leads/${qualifiedLead}/review`, { decision: "good" });
        check("a qualified lead can't take a review verdict", wrong.status === 409, wrong);

        const bad = await call("POST", `/api/runs/${run.id}/leads/${reviewLead}/review`, { decision: "maybe" });
        check("an unknown decision is rejected", bad.status === 400, bad);

        console.log("\n== reviewing the run ==");
        const rr = await call("POST", `/api/runs/${run.id}/review`, { decision: "good", note: "Usable with the 1 lead." });
        const { data: runRow } = await db.from("runs").select("*").eq("id", run.id).single();
        check("marks the run reviewed: good", rr.status === 200 && runRow?.review_decision === "good", rr);
        check("  the run keeps its needs_review status", runRow?.status === "needs_review");

        await db.from("leads").update({ review_decision: "good", reviewed_by_name: "t" }).eq("id", reviewLead);
        const { data: events } = await db.from("run_events").select("kind").eq("run_id", run.id);
        const kinds = (events ?? []).map((e) => e.kind);
        check("both verdicts are in the run log", kinds.includes("lead_reviewed") && kinds.includes("run_reviewed"), kinds);
      }
    }

    console.log("\n== marking a qualified lead processed ==");
    {
      const r = await call("POST", `/api/runs/${run.id}/leads/${qualifiedLead}/processed`, {
        processed: true,
        note: "Emailed from HubSpot.",
        suppress: true,
      });
      if (r.status === 409 && /0011_suppression/.test(String(r.body.error))) {
        skip("processed leads: apply 0011_suppression.sql");
      } else {
        check("marks it processed", r.status === 200, r);
        const { data: row } = await db.from("leads").select("*").eq("id", qualifiedLead).single();
        check("  who, when and the note are stored", Boolean(row?.processed_at && row?.processed_by_name) && row?.processed_note === "Emailed from HubSpot.", row);
        const { data: skipRow } = await db.from("suppressed_domains").select("*").eq("domain", "qualified-test.example").maybeSingle();
        check("  and its domain is on the skip list as contacted", skipRow?.reason === "contacted" && skipRow?.source_run_id === run.id, skipRow);

        const wrong = await call("POST", `/api/runs/${run.id}/leads/${reviewLead}/processed`, { processed: true });
        check("a needs-review lead can't be marked processed", wrong.status === 409, wrong);

        const undo = await call("POST", `/api/runs/${run.id}/leads/${qualifiedLead}/processed`, { processed: false });
        const { data: undone } = await db.from("leads").select("processed_at").eq("id", qualifiedLead).single();
        check("processing can be undone", undo.status === 200 && undone?.processed_at === null, undone);
        // Re-mark for the export check below.
        await call("POST", `/api/runs/${run.id}/leads/${qualifiedLead}/processed`, { processed: true, note: "Emailed from HubSpot." });
      }
    }

    console.log("\n== the team skip list ==");
    {
      const parsed = parseDomainList("https://www.Foo-Test.example/about, bar-test.example\nnot a domain");
      check("pasted lists are normalised to bare domains", parsed.domains.join(",") === "foo-test.example,bar-test.example", parsed);

      const r = await call("POST", "/api/suppression", {
        domains: "https://www.foo-test.example/about\nbar-test.example, nonsense",
        reason: "customer",
        note: "test",
      });
      if (r.status === 409 && /0011_suppression/.test(String(r.body.error))) {
        skip("skip list: apply 0011_suppression.sql");
      } else {
        check("adds domains, and says what it ignored", r.status === 200 && /Added 2/.test(String(r.body.note)) && /nonsense/.test(String(r.body.note)), r);
        const again = await call("POST", "/api/suppression", { domains: "foo-test.example", reason: "other" });
        const { data: kept } = await db.from("suppressed_domains").select("reason").eq("domain", "foo-test.example").single();
        check("re-adding keeps the original reason", again.status === 200 && kept?.reason === "customer", kept);

        // Discovery's view, from a different run than the fixture's.
        const skipMap = await loadSkipDomains("00000000-0000-0000-0000-000000000000");
        check("discovery skips listed domains with their reason", skipMap.get("foo-test.example") === "suppressed-customer", [...skipMap].slice(0, 5));
        check("  and domains qualified in earlier runs", skipMap.get("qualified-test.example") !== undefined, skipMap.get("qualified-test.example"));
        const own = await loadSkipDomains(run.id);
        check("  but not its own run's qualified leads", own.get("qualified-test.example") !== "qualified-earlier", own.get("qualified-test.example"));

        const del = await call("DELETE", "/api/suppression", { domain: "foo-test.example" });
        const { data: gone } = await db.from("suppressed_domains").select("domain").eq("domain", "foo-test.example").maybeSingle();
        check("a domain can be removed", del.status === 200 && !gone, del);
      }
    }

    console.log("\n== the spreadsheet carries the verdicts ==");
    {
      const res = await fetch(`${BASE}/api/runs/${run.id}/export?format=xlsx`, { headers: { cookie } });
      check("export returns a workbook", res.ok && /spreadsheetml/.test(res.headers.get("content-type") ?? ""), res.status);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await res.arrayBuffer());
      const headers = (name: string) => ((wb.getWorksheet(name)?.getRow(1).values as string[]) ?? []).slice(1);
      const cell = (name: string, header: string) => {
        const ws = wb.getWorksheet(name);
        const col = headers(name).indexOf(header) + 1;
        return col ? String(ws?.getRow(2).getCell(col).value ?? "") : undefined;
      };
      check("Needs review sheet has Review, Review note, Reviewed by", ["Review", "Review note", "Reviewed by"].every((h) => headers("Needs review").includes(h)), headers("Needs review"));
      check("Qualified sheet has Processed and Processing note", ["Processed", "Processing note"].every((h) => headers("Qualified").includes(h)), headers("Qualified"));
      if (!skipped.some((s) => s.includes("0010"))) {
        check("  the lead's verdict is filled in", cell("Needs review", "Review") === "Good", cell("Needs review", "Review"));
      }
      if (!skipped.some((s) => s.includes("0011"))) {
        check("  the lead's processing is filled in", /^Yes/.test(cell("Qualified", "Processed") ?? ""), cell("Qualified", "Processed"));
      }
    }
  } finally {
    await db.from("suppressed_domains").delete().in("domain", ["foo-test.example", "bar-test.example", "qualified-test.example"]);
    await db.from("runs").delete().eq("id", run.id);
    console.log(`\ncleaned up test run ${run.id}`);
  }

  console.log(`\n${passed} passed, ${failed} failed${skipped.length ? `, ${skipped.length} skipped (${skipped.join("; ")})` : ""}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
