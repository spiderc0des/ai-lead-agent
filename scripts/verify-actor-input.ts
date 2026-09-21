/**
 * Diff the input we send against the discovery actor's published schema.
 *
 * Apify silently ignores an input field whose name it does not recognise, so a
 * renamed add-on toggle would leave that add-on running at its default —
 * costing money, and in the enrichment case surfacing email addresses the
 * outreach-safety guide forbids. A wrong TYPE is louder (input validation
 * rejects the run) but is just as broken.
 *
 * Needs no API token: an actor's build is public.
 *
 *   npm run verify:actor-input
 */
import "dotenv/config";
import { buildActorInput, DEFAULT_DISCOVERY_ACTOR } from "@/lib/apify";

type SchemaProp = {
  type?: string;
  default?: unknown;
  properties?: Record<string, { type?: string }>;
};

const API = "https://api.apify.com/v2";

/** apify/google-search-scraper -> apify~google-search-scraper */
function apiId(actor: string): string {
  return actor.replace("/", "~");
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const body = (await res.json()) as { data?: Record<string, unknown> };
  return body.data ?? (body as Record<string, unknown>);
}

function jsType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v;
}

async function main() {
  const actor = process.env.APIFY_DISCOVERY_ACTOR || DEFAULT_DISCOVERY_ACTOR;
  console.log(`actor: ${actor}\n`);

  const meta = await getJson(`${API}/acts/${apiId(actor)}`);

  const pricing = (meta.pricingInfos as { pricingModel?: string }[] | undefined) ?? [];
  const model = pricing.at(-1)?.pricingModel ?? "UNKNOWN";
  console.log(`pricing model: ${model}`);
  if (model === "FLAT_PRICE_PER_MONTH") {
    console.error("  REFUSE — rental actor, charges a flat monthly fee once enabled.");
  } else if (model !== "PAY_PER_EVENT") {
    console.warn(`  note — not pay-per-event; re-check what a run costs before scaling up.`);
  }

  const buildId = (meta.taggedBuilds as { latest?: { buildId?: string } } | undefined)?.latest
    ?.buildId;
  if (!buildId) throw new Error("No tagged 'latest' build on this actor.");

  const build = await getJson(`${API}/acts/${apiId(actor)}/builds/${buildId}`);
  const rawSchema = build.inputSchema;
  if (!rawSchema) throw new Error("This build publishes no input schema.");

  const schema = (typeof rawSchema === "string" ? JSON.parse(rawSchema) : rawSchema) as {
    properties?: Record<string, SchemaProp>;
  };
  const props = schema.properties ?? {};

  // One query / one page is enough: we are checking key names and types.
  const sent = buildActorInput(["example query"], 1);

  let problems = 0;
  console.log(`\n=== what we send (${Object.keys(sent).length} fields) ===`);

  for (const [key, value] of Object.entries(sent)) {
    const prop = props[key];

    if (!prop) {
      problems++;
      console.error(`  MISSING   ${key} — not in the schema, so Apify ignores it silently`);
      continue;
    }

    const want = prop.type;
    const got = jsType(value);
    const typeOk = want === got || (want === "integer" && got === "number");

    if (!typeOk) {
      problems++;
      console.error(`  BAD TYPE  ${key} — schema wants ${want}, we send ${got}`);
      continue;
    }

    // For object fields, check the sub-keys we set actually exist.
    if (want === "object" && prop.properties && value && typeof value === "object") {
      const unknown = Object.keys(value as object).filter((k) => !(k in prop.properties!));
      if (unknown.length) {
        problems++;
        console.error(`  BAD SHAPE ${key} — unknown sub-key(s): ${unknown.join(", ")}`);
        continue;
      }
    }

    console.log(`  ok        ${key}`);
  }

  // Anything billable or email-related we are NOT pinning is worth knowing about.
  const RISKY = /enrich|email|scraper|prospect|aiMode|aiOverview|chatGpt|perplexity|copilot|gemini|paidAds/i;
  const unpinned = Object.keys(props).filter((k) => RISKY.test(k) && !(k in sent));

  if (unpinned.length) {
    console.log(`\n=== billable / contact-related fields we do NOT pin ===`);
    for (const k of unpinned) {
      console.log(`  ${k}  (schema default: ${JSON.stringify(props[k].default)})`);
    }
    console.log(
      "  Each relies on the actor's own default staying off. Pin any that matters to you.",
    );
  }

  console.log(
    problems === 0
      ? `\nPASS — every field we send exists and has the right type.`
      : `\nFAIL — ${problems} problem(s) above. Fix buildActorInput() in src/lib/apify.ts.`,
  );
  process.exit(problems === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nverification failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
