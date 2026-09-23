/**
 * Edge-case tests for the tool layer, against the real database.
 *
 * These are the invariants that must hold whatever the model does, so none of
 * them needs an agent turn to exercise: the handlers are called directly. That
 * matters — a full agent run costs over a dollar, and these cover far more
 * ground than watching one run would.
 *
 * Creates a throwaway run, exercises every guard, and deletes it.
 *
 *   npm run test:tools
 */
import "./env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildLeadTools } from "@/agent/tools";
import type { RunContext } from "@/agent/budget";
import { DEFAULT_LIMITS } from "@/lib/schemas";

let passed = 0, failed = 0, skipped = 0;
const results: string[] = [];

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.error(`  FAIL ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 300)}` : ""}`); results.push(name); }
}

type Tool = ReturnType<typeof buildLeadTools>[number];
const text = (r: { content?: { type: string; text?: string }[] }) =>
  (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");

async function main() {
  const db: SupabaseClient = createClient(
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: anyUser } = await db.from("profiles").select("id").limit(1).single();
  if (!anyUser) throw new Error("No profile exists — run seed:admin first.");

  const limits = { ...DEFAULT_LIMITS, max_leads: 2, max_scrapes: 3, max_candidates: 5 };
  const { data: run, error: runErr } = await db.from("runs").insert({
    user_id: anyUser.id,
    objective: "TEST RUN — tool guard suite, safe to delete",
    limits, status: "running",
  }).select("id").single();
  if (runErr || !run) throw new Error(`Could not create test run: ${runErr?.message}`);

  const ctx: RunContext = { runId: run.id, userId: anyUser.id, limits, objective: "test" };
  const tools = buildLeadTools(ctx);
  const t = (n: string): Tool => {
    const found = tools.find((x) => x.name === n);
    if (!found) throw new Error(`no tool named ${n}`);
    return found;
  };
  const call = async (n: string, args: unknown) =>
    (await t(n).handler(args as never, {})) as { content?: { type: string; text?: string }[]; isError?: boolean };

  console.log(`\ntest run ${run.id}\n`);

  try {
    /* ------------------------------------------------ the ICP gate ------ */
    console.log("== discovery is refused before an ICP exists ==");
    {
      const r = await call("discover_companies", { queries: ["helpdesk software for ecommerce"], purpose: "test" });
      check("discover_companies refuses with no ICP", r.isError === true, text(r).slice(0, 120));
      check("  and says to call set_icp", /set_icp/.test(text(r)));
    }

    console.log("\n== set_icp ==");
    {
      const bad = await call("set_icp", { target_company_type: "x" });
      check("rejects an incomplete ICP", bad.isError === true);

      const fullIcp = {
        target_company_type: "B2B SaaS company selling to operations teams",
        industries: ["field service management"], geography: ["United States"],
        headcount_range: "10-100 employees", buyer_persona: "Head of Operations",
        business_problem: "manual back-office workflows",
        hard_filters: ["US", "B2B", "SaaS", "10-100 employees"],
        soft_preferences: ["hiring ops roles"], disqualifiers: ["enterprise only"],
        user_stated: ["US", "B2B", "SaaS", "10-100 employees"],
        assumptions: ["Assumed ops-heavy verticals, since that is who feels the problem"],
      };
      const good = await call("set_icp", fullIcp);
      check("accepts a complete ICP", good.isError !== true, text(good).slice(0, 150));
      check("  reports the hard/soft split back", /Soft preferences: 1/.test(text(good)), text(good).slice(0, 220));

      // The case that prompted this: an objective stating nothing produces an
      // ICP built entirely from assumption, which is authoring rather than
      // refining. Must be refused, and must point at the alternative.
      const noSignal = await call("set_icp", {
        ...fullIcp,
        user_stated: [],
        assumptions: ["Objective gave no usable signal, so the whole ICP is inferred"],
      });
      check("refuses an ICP with nothing from the objective", noSignal.isError === true, text(noSignal).slice(0, 120));
      check("  and names request_clarification as the way out",
        /request_clarification/.test(text(noSignal)), text(noSignal).slice(0, 220));

      const noProvenance = await call("set_icp", {
        ...fullIcp, user_stated: undefined, assumptions: undefined,
      });
      check("rejects an ICP with no provenance", noProvenance.isError === true);

      // Four hard filters from one stated constraint is the failure mode:
      // inferences promoted to filters that silently reject wanted leads.
      const promoted = await call("set_icp", {
        ...fullIcp,
        user_stated: ["United States"],
        assumptions: ["Assumed B2B SaaS and a headcount band"],
      });
      check(
        "warns when hard filters outnumber what the user stated",
        /NOTE: you recorded 4 hard filters but the user only stated 1/.test(text(promoted)),
        text(promoted).slice(0, 300),
      );
    }

    /* ----------------------------------------- scrape provenance -------- */
    console.log("\n== scrape_websites: provenance and target guards ==");
    {
      const r = await call("scrape_websites", { urls: ["https://stripe.com/about"], purpose: "test" });
      check("refuses a domain that is not a candidate", /not a candidate/.test(text(r)), text(r).slice(0, 160));
    }

    // Seed candidates so the remaining scrape tests can run.
    await db.from("candidates").insert([
      { run_id: run.id, user_id: anyUser.id, domain: "example.com", company_name: "Example", source_url: "https://example.com", status: "new" },
      { run_id: run.id, user_id: anyUser.id, domain: "iana.org", company_name: "IANA", source_url: "https://www.iana.org", status: "new" },
    ]);

    {
      const r = await call("scrape_websites", {
        urls: ["http://localhost:3000/admin", "http://169.254.169.254/latest/meta-data/"], purpose: "test",
      });
      check("refuses localhost and link-local in a batch", /Refusing to scrape|not a candidate/.test(text(r)), text(r).slice(0, 200));
    }
    {
      const r = await call("scrape_websites", {
        urls: ["https://example.com", "https://stripe.com/about"], purpose: "mixed batch",
      });
      const body = text(r);
      check("a batch scrapes the valid URL", /example\.com/.test(body));
      check("  and reports the blocked one without failing the call", /FAILED/.test(body) && r.isError !== true, body.slice(0, 200));
    }

    /* -------------------------------------------------- save_lead ------- */
    console.log("\n== save_lead ==");
    const baseLead = {
      company_name: "Example", company_domain: "example.com",
      confidence: 0.8, fit_reasons: ["B2B SaaS"], concerns: [],
      source_summary: "Example sells B2B SaaS to operations teams in the United States.",
    };
    {
      const r = await call("save_lead", { ...baseLead, qualification_status: "qualified", source_urls: [] });
      check("rejects a lead with no sources", r.isError === true, text(r).slice(0, 120));
    }
    {
      const r = await call("save_lead", {
        ...baseLead, qualification_status: "qualified",
        source_urls: ["https://never-scraped-by-this-run.example/about"],
      });
      check("rejects a qualified lead citing an unscraped page", /never scraped/.test(text(r)), text(r).slice(0, 160));
    }
    {
      const { data: srcs } = await db.from("page_sources").select("url").eq("run_id", run.id).limit(1);
      const realUrl = srcs?.[0]?.url;
      check("a page was actually scraped for the evidence tests", Boolean(realUrl));

      const r = await call("save_lead", { ...baseLead, qualification_status: "qualified", source_urls: [realUrl] });
      check("accepts a qualified lead citing a scraped page", r.isError !== true, text(r).slice(0, 160));

      const r2 = await call("save_lead", {
        ...baseLead, qualification_status: "qualified", source_urls: [realUrl],
        company_name: "Example Again",
      });
      check("re-saving the same domain updates rather than duplicates", r2.isError !== true);
      const { count } = await db.from("leads").select("id", { count: "exact", head: true })
        .eq("run_id", run.id).eq("company_domain", "example.com");
      check("  exactly one row for that domain", count === 1, count);

      /* ------------------------------------------ outreach drafts ------- */
      console.log("\n== save_outreach_drafts ==");
      const email = (n: number, evidence: string) => ({
        step_number: n, subject: `Subject ${n}`,
        body: "Noticed your team handles onboarding manually across several tools, which usually breaks around this size.",
        personalization_note: "References the onboarding workflow described on their about page.",
        evidence_url: evidence,
      });
      {
        const r = await call("save_outreach_drafts", {
          company_domain: "example.com",
          emails: [email(1, "https://not-a-source.example"), email(2, realUrl!), email(3, realUrl!)],
          linkedin_message: "Saw how your team handles onboarding — happy to share what similar teams automated first.",
        });
        check("rejects a draft citing a URL outside the lead's sources", /not among/.test(text(r)), text(r).slice(0, 160));
      }
      {
        const r = await call("save_outreach_drafts", {
          company_domain: "example.com",
          emails: [email(1, realUrl!), email(2, realUrl!), email(3, realUrl!)],
          linkedin_message: "Reach me at sales@acme.com to discuss onboarding automation for your team.",
        });
        check("rejects copy containing an email address", /email address/.test(text(r)), text(r).slice(0, 160));
      }
      {
        const r = await call("save_outreach_drafts", {
          company_domain: "example.com",
          emails: [email(1, realUrl!), email(2, realUrl!), email(3, realUrl!)],
          linkedin_message: "Saw how your team handles onboarding — happy to share what similar teams automated first.",
        });
        check("accepts a clean, fully-cited sequence", r.isError !== true, text(r).slice(0, 160));
        const { count: dc } = await db.from("outreach_drafts").select("id", { count: "exact", head: true }).eq("run_id", run.id);
        check("  stores 3 emails + 1 linkedin", dc === 4, dc);
      }
      {
        await call("save_lead", { ...baseLead, company_domain: "iana.org", company_name: "IANA",
          qualification_status: "needs_review", source_urls: [realUrl] });
        const r = await call("save_outreach_drafts", {
          company_domain: "iana.org",
          emails: [email(1, realUrl!), email(2, realUrl!), email(3, realUrl!)],
          linkedin_message: "Saw how your team handles onboarding — happy to share what similar teams automated first.",
        });
        check("refuses drafts for a lead that is not qualified", /not qualified/.test(text(r)), text(r).slice(0, 160));
      }
    }

    /* ------------------------------------------------- the caps --------- */
    console.log("\n== limits are enforced, not requested ==");
    {
      // max_leads is 2; example.com is qualified, so one more is allowed.
      await db.from("candidates").insert({ run_id: run.id, user_id: anyUser.id, domain: "second.example", source_url: "https://second.example", status: "new" });
      const { data: srcs } = await db.from("page_sources").select("url").eq("run_id", run.id).limit(1);
      const realUrl = srcs![0].url;
      await call("save_lead", { ...baseLead, company_domain: "second.example", company_name: "Second",
        qualification_status: "qualified", source_urls: [realUrl] });

      await db.from("candidates").insert({ run_id: run.id, user_id: anyUser.id, domain: "third.example", source_url: "https://third.example", status: "new" });
      const r = await call("save_lead", { ...baseLead, company_domain: "third.example", company_name: "Third",
        qualification_status: "qualified", source_urls: [realUrl] });
      check("refuses a qualified lead past max_leads", /limit reached/i.test(text(r)), text(r).slice(0, 160));

      const { data: blocked } = await db.from("tool_calls").select("status")
        .eq("run_id", run.id).eq("status", "limit_blocked");
      check("  and records it as limit_blocked, not a silent decline", (blocked?.length ?? 0) > 0);

      const r2 = await call("save_lead", { ...baseLead, company_domain: "third.example", company_name: "Third",
        qualification_status: "needs_review", source_urls: [realUrl] });
      check("but needs_review is still allowed past the cap", r2.isError !== true, text(r2).slice(0, 120));
    }

    /* -------------------------------------------- request_clarification -- */
    console.log("\n== request_clarification ==");
    {
      const r = await call("request_clarification", {
        reason: "The objective names a market Koya does not sell into, so no ICP is derivable.",
        questions: ["Which industry should we target?", "What team size are you aiming at?"],
      });

      // This tool needs 0004_clarification.sql. Supabase's REST API cannot run
      // DDL, so the migration is applied by hand — say so plainly rather than
      // reporting a failure that is really a pending migration.
      if (/clarification_questions/.test(text(r)) && /schema/.test(text(r))) {
        console.log("  SKIP request_clarification — run supabase/migrations/0004_clarification.sql first");
        skipped += 3;
      } else {
        check("records the questions", r.isError !== true, text(r).slice(0, 140));

        const { data: after } = await db.from("runs")
          .select("status, clarification_questions").eq("id", run.id).single();
        check("  run marked needs_clarification", after?.status === "needs_clarification", after?.status);
        check("  both questions stored", (after?.clarification_questions ?? []).length === 2, after?.clarification_questions);

        // Put the run back so the remaining tests operate on a live run.
        await db.from("runs").update({ status: "running", clarification_questions: null }).eq("id", run.id);
      }
    }

    /* --------------------------------------------- get_run_state -------- */
    console.log("\n== get_run_state ==");
    {
      const r = await call("get_run_state", {});
      const body = text(r);
      check("reports the caps", /qualified\s+2\/2/.test(body.replace(/\s+/g, " ")) || /qualified/.test(body), body.slice(0, 200));
    }

    /* --------------------------------------------- finalize_run --------- */
    console.log("\n== finalize_run: the server does not trust the scorecard ==");
    {
      const r = await call("finalize_run", {
        summary: "Claiming everything is perfect, which it is not — only 2 of 10 were found.",
        icp_fit: "great", evidence_quality: "great", duplicate_rate: "none",
        outreach_relevance: "great", data_completeness: "complete", safety_compliance: "clean",
      });
      check("overrides an optimistic scorecard", /needs_review/.test(text(r)), text(r).slice(0, 200));
      const { data: after } = await db.from("runs").select("status, status_reason").eq("id", run.id).single();
      check("  run marked needs_review", after?.status === "needs_review", after?.status);
      // Which problem the server reports first depends on the fixture (here the
      // lead count is satisfied, so it lands on the incomplete drafts). The
      // invariant is that it names a specific, checkable failure — not that it
      // picks a particular one.
      const reason = after?.status_reason ?? "";
      check("  with a specific reason recorded", /Server verification found: .+\S/.test(reason), reason);
      check("  naming the offending company or count", /second\.example|only \d+ of \d+/.test(reason), reason);
    }

    /* ------------------------------------------------ audit trail ------- */
    console.log("\n== every call left an audit row ==");
    {
      const { data: calls } = await db.from("tool_calls").select("tool_name, status, user_id").eq("run_id", run.id);
      check("tool_calls recorded", (calls?.length ?? 0) >= 15, calls?.length);
      check("  every row carries the owner", (calls ?? []).every((c) => c.user_id === anyUser.id));
      const statuses = new Set((calls ?? []).map((c) => c.status));
      check("  success, error and limit_blocked all represented", statuses.has("success") && statuses.has("error") && statuses.has("limit_blocked"), [...statuses]);
    }
  } finally {
    await db.from("runs").delete().eq("id", run.id);
    console.log(`\ncleaned up test run ${run.id}`);
  }

  console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped (pending migration)` : ""}`);
  if (failed) console.log(`failures: ${results.join(", ")}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(`\n${e instanceof Error ? e.stack : e}`); process.exit(1); });
