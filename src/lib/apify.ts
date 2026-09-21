import "server-only";
import { ApifyClient } from "apify-client";

/**
 * Apify is used for ONE thing: company discovery. Website scraping goes
 * through Firecrawl (see firecrawl.ts), per the PRD.
 *
 * Cost discipline baked in here rather than left to the agent:
 *   * every run is capped (maxPagesPerQuery + maxItems) — never uncapped
 *   * every paid add-on is hard-coded off
 *   * rental (flat monthly) actors are refused before they can be started
 *   * the run is waited on with a timeout so nothing is left running
 */

/** Pay-per-event price of the default actor: $1.80 per 1,000 result pages. */
export const USD_PER_SEARCH_PAGE = 0.0018;

/**
 * Apify's own floor for `maxTotalChargeUsd`. A run asking for less is rejected
 * outright with "Maximum cost per run is less than the allowed minimum".
 *
 * This is a CEILING, not a spend: a real discovery call costs about $0.007.
 * The actual limiter is maxPagesPerQuery plus our own ledger reservation —
 * this only stops a runaway actor.
 */
export const APIFY_MIN_RUN_CHARGE_USD = 0.5;

export const DEFAULT_DISCOVERY_ACTOR = "apify/google-search-scraper";

/**
 * Assumed organic results per Google page. This is an ESTIMATE used to turn a
 * remaining-candidate budget into a page count — the actor has no
 * results-per-page input, so we cannot set it. Verify with
 * `npm run verify:actor-input`.
 */
export const RESULTS_PER_PAGE = 10;

export type DiscoveryResult = {
  title: string | null;
  url: string;
  description: string | null;
  query: string;
};

export type DiscoveryRunReport = {
  results: DiscoveryResult[];
  pagesRequested: number;
  actualCostUsd: number | null;
  runId: string;
  runStatus: string;
  datasetId: string;
};

function client(): ApifyClient {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error(
      "APIFY_TOKEN is not set. Use the TEAM account token — runs bill to whichever account starts them.",
    );
  }
  return new ApifyClient({ token });
}

function actorId(): string {
  return process.env.APIFY_DISCOVERY_ACTOR || DEFAULT_DISCOVERY_ACTOR;
}

/** Worst-case cost of a discovery call, used to reserve budget before spending. */
export function estimateDiscoveryCostUsd(pages: number): number {
  return Number((pages * USD_PER_SEARCH_PAGE).toFixed(6));
}

/**
 * Refuse to start an actor that bills a flat monthly rental fee. The PRD is
 * explicit that enabling one charges immediately, so this is checked before
 * the first run rather than discovered on the invoice.
 */
export async function assertActorIsMetered(): Promise<string> {
  const actor = await client().actor(actorId()).get();
  if (!actor) throw new Error(`Apify actor not found: ${actorId()}`);

  const models = (actor.pricingInfos ?? []).map((p) => p.pricingModel);
  const current = models.at(-1) ?? "UNKNOWN";

  if (current === "FLAT_PRICE_PER_MONTH") {
    throw new Error(
      `Refusing to run ${actorId()}: it is a rental actor (FLAT_PRICE_PER_MONTH), which charges a flat monthly fee the moment it is enabled.`,
    );
  }
  return current;
}

/**
 * The exact input sent to the discovery actor.
 *
 * Exported so `scripts/verify-actor-input.ts` can diff these keys against the
 * actor's published input schema — a name that drifts is silently ignored by
 * Apify, which would leave a billable add-on running at its default.
 *
 * Every add-on below is an OBJECT in the schema, not a boolean. Sending
 * `false` where an object is expected fails input validation; sending the
 * documented shape with its switch off is both valid and self-documenting,
 * and survives the actor changing a default.
 */
export function buildActorInput(
  queries: string[],
  pagesPerQuery: number,
): Record<string, unknown> {
  return {
    queries: queries.join("\n"),

    // Hard stop: never start an actor with an uncapped input.
    maxPagesPerQuery: pagesPerQuery,

    countryCode: "us",
    languageCode: "en",
    mobileResults: false,

    // --- every billable add-on explicitly OFF -----------------------------
    // Cost control, and the two enrichment switches would also breach the
    // outreach-safety rule against finding or validating email addresses.
    websiteContentScraper: { enable: false },
    maximumLeadsEnrichmentRecords: 0,
    verifyLeadsEnrichmentEmails: false,
    focusOnPaidAds: false,
    aiModeSearch: { enableAiMode: false },
    aiOverview: { scrapeFullAiOverview: false },
    chatGptSearch: { enableChatGpt: false },
    perplexitySearch: { enablePerplexity: false },
    copilotSearch: { enableCopilot: false },
    geminiSearch: { enableGemini: false },

    // Defaults to true. We never read the stored HTML, so don't store it.
    saveHtmlToKeyValueStore: false,

    // linkProspecting is deliberately omitted: its schema default is null,
    // which is off. Sending an empty object could read as opting in.
  };
}

/**
 * Run one discovery call.
 *
 * @param queries  Search queries the agent generated from the refined ICP.
 * @param maxPages Hard page cap, already clamped against the run's remaining
 *                 candidate budget AND the global Apify budget by the caller.
 */
export async function discoverCompanies(
  queries: string[],
  maxPages: number,
): Promise<DiscoveryRunReport> {
  if (queries.length === 0) throw new Error("No queries supplied");
  if (maxPages < 1) throw new Error("maxPages must be at least 1");

  const api = client();
  const pagesPerQuery = Math.max(1, Math.floor(maxPages / queries.length));
  const pagesRequested = pagesPerQuery * queries.length;

  const run = await api.actor(actorId()).call(
    buildActorInput(queries, pagesPerQuery),
    {
      // Never leave an actor running: bounded wait, bounded memory.
      waitSecs: 180,
      memory: 1024,
      // maxItems is the PAY-PER-RESULT lever and is ignored by a
      // pay-per-event actor; maxTotalChargeUsd is the one that applies here.
      // Passing the wrong one had every discovery call rejected at start.
      maxTotalChargeUsd: APIFY_MIN_RUN_CHARGE_USD,
    },
  );

  const { items } = await api.dataset(run.defaultDatasetId).listItems({
    limit: pagesRequested,
  });

  const results: DiscoveryResult[] = [];
  for (const page of items as Record<string, unknown>[]) {
    const query = String(page.searchQuery ?? "");
    const organic = (page.organicResults ?? []) as Record<string, unknown>[];
    for (const r of organic) {
      const url = typeof r.url === "string" ? r.url : null;
      if (!url) continue;
      results.push({
        title: typeof r.title === "string" ? r.title : null,
        url,
        description: typeof r.description === "string" ? r.description : null,
        query,
      });
    }
  }

  return {
    results,
    pagesRequested,
    actualCostUsd: run.usageTotalUsd ?? null,
    runId: run.id,
    runStatus: run.status,
    datasetId: run.defaultDatasetId,
  };
}
