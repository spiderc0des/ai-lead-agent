/**
 * Smallest possible Apify run: one query, one page.
 *
 * Run this BEFORE any real run, and check the Apify Console afterwards to see
 * what it actually cost. The PRD's rule is test small, then scale — this is the
 * "test small" half, and it also verifies the actor is metered rather than a
 * flat-fee rental.
 *
 *   npm run smoke:apify
 */
import "dotenv/config";
import { assertActorIsMetered, discoverCompanies, estimateDiscoveryCostUsd } from "@/lib/apify";

async function main() {
  if (!process.env.APIFY_TOKEN) {
    console.error("APIFY_TOKEN is not set. Use the TEAM account token, not your personal one.");
    process.exit(1);
  }

  const actor = process.env.APIFY_DISCOVERY_ACTOR ?? "apify/google-search-scraper";
  console.log(`actor: ${actor}`);

  const model = await assertActorIsMetered();
  console.log(`pricing model: ${model}  (a rental actor would have been refused here)`);

  const pages = 1;
  console.log(`\nrunning 1 query x ${pages} page — estimated $${estimateDiscoveryCostUsd(pages).toFixed(4)}`);

  const report = await discoverCompanies(["b2b saas company operations automation"], pages);

  console.log(`\nrun ${report.runId} finished with status ${report.runStatus}`);
  console.log(`reported cost: ${report.actualCostUsd === null ? "(not reported yet)" : `$${report.actualCostUsd.toFixed(4)}`}`);
  console.log(`organic results: ${report.results.length}`);
  for (const r of report.results.slice(0, 5)) {
    console.log(`  - ${r.url}`);
  }

  console.log(
    `\nOpen https://console.apify.com/actors/runs/${report.runId} and confirm the run finished and what it cost.`,
  );
}

main().catch((err) => {
  console.error("\nsmoke test failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
