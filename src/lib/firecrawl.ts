import "server-only";

/**
 * Website scraping. Firecrawl v2 is the primary path; a raw fetch + crude
 * HTML-to-text conversion is the fallback when the key is missing or the API
 * fails, so one dead key cannot stop a whole run.
 *
 * Called through plain fetch rather than an SDK: the v2 REST shape is stable
 * and documented, and this avoids a dependency whose package name has moved
 * around.
 */

const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";

/** Re-scraping the same URL within this window is served from Firecrawl's cache. */
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type ScrapeResult = {
  url: string;
  title: string | null;
  markdown: string;
  httpStatus: number | null;
  scraper: "firecrawl" | "fallback";
};

export function firecrawlConfigured(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY);
}

async function scrapeWithFirecrawl(url: string): Promise<ScrapeResult> {
  const res = await fetch(FIRECRAWL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      blockAds: true,
      maxAge: CACHE_MAX_AGE_MS,
      timeout: 45_000,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Firecrawl ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ""}`,
    );
  }

  const payload = (await res.json()) as {
    success?: boolean;
    data?: {
      markdown?: string;
      metadata?: { title?: string; statusCode?: number; url?: string };
    };
  };

  const markdown = payload.data?.markdown ?? "";
  if (!markdown.trim()) throw new Error("Firecrawl returned no markdown content");

  return {
    url: payload.data?.metadata?.url ?? url,
    title: payload.data?.metadata?.title ?? null,
    markdown,
    httpStatus: payload.data?.metadata?.statusCode ?? 200,
    scraper: "firecrawl",
  };
}

/** Minimal HTML -> text. Good enough to qualify from; not a Readability port. */
function htmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : null;

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return {
    title,
    text: decodeEntities(text)
      .replace(/[ \t ]+/g, " ")
      .replace(/\n\s*\n\s*\n+/g, "\n\n")
      .trim(),
  };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

async function scrapeWithFetch(url: string): Promise<ScrapeResult> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      // Identify honestly. No attempt to defeat access controls — the
      // outreach-safety guide forbids bypassing them.
      "User-Agent":
        "KoyaLeadAgent/1.0 (+lead qualification research; contact via site owner)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(30_000),
  });

  const html = await res.text();
  const { title, text } = htmlToText(html);

  if (!res.ok) {
    throw new Error(`Fetch fallback got HTTP ${res.status} for ${url}`);
  }
  if (!text.trim()) throw new Error(`Fetch fallback extracted no text from ${url}`);

  return { url: res.url || url, title, markdown: text, httpStatus: res.status, scraper: "fallback" };
}

/**
 * Scrape one page. Prefers Firecrawl, falls back to raw fetch, and reports
 * which path produced the content so the evidence trail stays honest.
 */
export async function scrapePage(url: string): Promise<ScrapeResult> {
  if (firecrawlConfigured()) {
    try {
      return await scrapeWithFirecrawl(url);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      try {
        const fallback = await scrapeWithFetch(url);
        return fallback;
      } catch {
        throw new Error(`Firecrawl failed (${reason}) and the fetch fallback also failed`);
      }
    }
  }
  return scrapeWithFetch(url);
}
