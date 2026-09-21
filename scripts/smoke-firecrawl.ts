/**
 * Scrape one page end to end: fetch, sanitise, report.
 *
 * Pass a URL to test a specific site, including the deployed injection
 * honeypot:
 *   npm run smoke:firecrawl -- https://your-app.example/test/injection-honeypot
 */
import "dotenv/config";
import { scrapePage, firecrawlConfigured } from "@/lib/firecrawl";
import { sanitizeScrapedContent } from "@/agent/sanitize";
import { assertPublicHttpUrl } from "@/lib/domain";

async function main() {
  const target = process.argv[2] ?? "https://www.anthropic.com/";
  console.log(`firecrawl key: ${firecrawlConfigured() ? "set" : "NOT set — the fetch fallback will be used"}`);
  console.log(`target: ${target}\n`);

  assertPublicHttpUrl(target);

  const page = await scrapePage(target);
  const clean = sanitizeScrapedContent(page.markdown, page.url);

  console.log(`scraper:      ${page.scraper}`);
  console.log(`http status:  ${page.httpStatus}`);
  console.log(`title:        ${page.title ?? "(none)"}`);
  console.log(`chars:        ${clean.chars}${clean.truncated ? " (truncated)" : ""}`);
  console.log(`injection:    ${clean.flags.length ? clean.flags.join(", ") : "none detected"}`);
  console.log(`\n--- first 600 chars the agent would receive ---\n`);
  console.log(clean.wrapped.slice(0, 600));
}

main().catch((err) => {
  console.error("\nsmoke test failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
