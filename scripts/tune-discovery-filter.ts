/**
 * Measure the discovery filter against a real run's candidate pool.
 *
 * The filter decides what never gets scraped, so tuning it by intuition is
 * guesswork. This replays a finished run's candidates through the current
 * filter and reports the only metric that matters — whether it would have
 * dropped a company that went on to qualify — alongside how much junk it
 * removes.
 *
 *   npm run tune:discovery -- <run-id>
 */
import "./env";
import { createClient } from "@supabase/supabase-js";
import { looksLikeDirectory, isNonCompanyHost } from "@/lib/domain";

const RUN = process.argv[2];

async function main() {
  if (!RUN) throw new Error("Usage: npm run tune:discovery -- <run-id>");
  const db = createClient(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: cands } = await db.from("candidates")
    .select("domain, company_name, snippet, source_url, status").eq("run_id", RUN);

  // Domains the agent actually turned into leads = known-good (real companies).
  const { data: leads } = await db.from("leads").select("company_domain, qualification_status")
    .eq("run_id", RUN);
  const evaluated = new Map((leads ?? []).map(l => [l.company_domain, l.qualification_status]));

  let dropped = 0, kept = 0, falsePositives = 0;
  const dropList: string[] = [], keepList: string[] = [];

  for (const c of cands ?? []) {
    // Production order: the host blocklist runs first, then the listicle check.
    const blocked = isNonCompanyHost(c.source_url);
    const v = blocked
      ? { isDirectory: true, reason: "blocked-host" }
      : looksLikeDirectory(c.company_name, c.snippet, c.source_url);
    if (v.isDirectory) {
      dropped++;
      // The only unacceptable loss is a company that became QUALIFIED.
      // Dropping one the agent later rejected is a saved scrape, not an error.
      const wasQualified = evaluated.get(c.domain) === "qualified";
      if (wasQualified) { falsePositives++; dropList.push(`  !! ${c.domain} [${v.reason}] — WAS QUALIFIED, MUST NOT DROP`); }
      else dropList.push(`     ${c.domain} [${v.reason}] ${String(c.company_name ?? "").slice(0, 70)}`);
    } else {
      kept++;
      keepList.push(`     ${c.domain.padEnd(28)} ${evaluated.has(c.domain) ? "[evaluated: " + evaluated.get(c.domain) + "]" : ""} ${String(c.company_name ?? "").slice(0, 60)}`);
    }
  }

  console.log(`candidates: ${cands?.length}\n`);
  console.log(`=== WOULD DROP (${dropped}) ===`);
  dropList.forEach(l => console.log(l));
  console.log(`\n=== WOULD KEEP (${kept}) ===`);
  keepList.forEach(l => console.log(l));
  const keptEval = (cands ?? []).filter(c => { const b = isNonCompanyHost(c.source_url); const v = b ? {isDirectory:true} : looksLikeDirectory(c.company_name, c.snippet, c.source_url); return !v.isDirectory && evaluated.has(c.domain); }).length;
  console.log(`\nqualified leads wrongly dropped : ${falsePositives}   <-- must be 0`);
  console.log(`pool: ${cands?.length} -> ${kept}  (${(100 - kept / (cands?.length ?? 1) * 100).toFixed(0)}% junk removed)`);
  console.log(`companies worth evaluating kept : ${keptEval} of ${evaluated.size} the agent actually reached`);
  console.log(`signal density: ${(keptEval / kept * 100).toFixed(0)}% of the kept pool proved real (was ${(evaluated.size / (cands?.length ?? 1) * 100).toFixed(0)}%)`);
}
main().catch(e => { console.error(e); process.exit(1); });
