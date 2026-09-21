/**
 * Domain normalisation for candidate de-duplication.
 *
 * Discovery returns search-result URLs; the same company often appears several
 * times (https/http, www/bare, /pricing vs /about, utm noise). Everything is
 * reduced to a bare registrable domain so `unique (run_id, domain)` in
 * Postgres can do the de-duplication for us.
 */

/**
 * Multi-part public suffixes we actually meet in practice. A full Public
 * Suffix List would be more correct, but pulling one in for a handful of
 * ccTLDs is not worth the dependency here.
 */
const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk",
  "com.au", "net.au", "org.au", "edu.au",
  "co.nz", "co.za", "co.jp", "co.in", "co.kr",
  "com.br", "com.mx", "com.sg", "com.tr", "com.hk",
]);

/**
 * Hosts that are never the company we are researching: search engines, social
 * networks, directories, job boards, and content farms. Discovery drops these
 * outright — a LinkedIn or Crunchbase URL is not a company website, and
 * scraping a job board teaches us nothing first-hand about the company.
 */
const NON_COMPANY_HOSTS = [
  "google.", "bing.", "duckduckgo.", "yahoo.", "baidu.",
  "linkedin.com", "facebook.com", "twitter.com", "x.com", "instagram.com",
  "youtube.com", "tiktok.com", "reddit.com", "pinterest.com", "threads.net",
  "wikipedia.org", "medium.com", "substack.com", "quora.com",
  "crunchbase.com", "pitchbook.com", "owler.com", "zoominfo.com",
  "apollo.io", "rocketreach.co", "lusha.com", "signalhire.com",
  "indeed.com", "glassdoor.com", "ziprecruiter.com", "lever.co",
  "greenhouse.io", "workable.com", "smartrecruiters.com", "ashbyhq.com",
  "github.com", "gitlab.com", "stackoverflow.com",
  "amazon.com", "apple.com", "microsoft.com", "salesforce.com",
  "producthunt.com", "angel.co", "wellfound.com", "trustpilot.com",
  "g2.com", "capterra.com", "getapp.com", "softwareadvice.com",
  "clutch.co", "goodfirms.co", "yelp.com", "bbb.org",
  "forbes.com", "techcrunch.com", "businessinsider.com", "inc.com",
  "prnewswire.com", "businesswire.com", "globenewswire.com",
  // Investors, accelerators and market-data sites. All of these appeared in a
  // real run's candidate pool and none of them is ever the company we want.
  "ycombinator.com", "workatastartup.com", "a16z.com", "sequoiacap.com",
  "tracxn.com", "cbinsights.com", "dealroom.co", "seedtable.com",
  "topstartups.io", "f6s.com", "builtin.com", "saasvclist.com",
  "naukri.com", "getonbrd.com", "startup.jobs", "remoterocketship.com",
  "bebee.com", "jobsdb.com", "underdog.io", "4dayweek.io",
];

/** Strip scheme, credentials, port, path, query and `www.` down to the host. */
export function toHost(input: string): string | null {
  if (!input) return null;
  let raw = input.trim().toLowerCase();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) raw = `https://${raw}`;

  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    return null;
  }

  host = host.replace(/^www\./, "").replace(/\.$/, "");
  if (!host.includes(".")) return null;
  // Bare IPs are never a company domain.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  return host;
}

/**
 * Reduce a host to its registrable domain: `blog.acme.co.uk` -> `acme.co.uk`.
 */
export function registrableDomain(input: string): string | null {
  const host = toHost(input);
  if (!host) return null;

  const parts = host.split(".");
  if (parts.length <= 2) return host;

  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

/** True when the host is a directory, social network, or other non-company site. */
export function isNonCompanyHost(input: string): boolean {
  const host = toHost(input);
  if (!host) return true;
  return NON_COMPANY_HOSTS.some(
    (bad) => host === bad || host.endsWith(`.${bad}`) || host.startsWith(bad),
  );
}

/**
 * Guard for scrape targets. Blocks anything that is not a public http(s) URL:
 * no file://, no localhost, no RFC1918 / link-local / loopback addresses.
 * Stops a scraped page from talking the agent into probing internal services.
 */
export function assertPublicHttpUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Not a valid URL: ${input}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http(s) URLs may be scraped, got ${url.protocol}`);
  }

  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error(`Refusing to scrape a local address: ${host}`);
  }

  // IPv4 private / loopback / link-local ranges.
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    ) {
      throw new Error(`Refusing to scrape a private address: ${host}`);
    }
  }
  if (host.startsWith("[") || host.includes(":")) {
    throw new Error(`Refusing to scrape an IPv6 literal: ${host}`);
  }

  return url;
}

/**
 * Listicle and directory detection.
 *
 * A search for "B2B SaaS companies" returns mostly pages *about* companies:
 * "Top 20 tools", VC portfolio lists, job boards, comparison pages. The
 * hardcoded host list above catches the famous ones; this catches the long
 * tail, which is where most of the pool actually goes. On a real run, 60
 * candidates yielded roughly 15 genuine company sites — the rest were these.
 *
 * Judged from the search result's own title and snippet, which is free.
 * Scraping one to find out costs a page of the scrape budget.
 */
const LISTICLE_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "ranked-list", re: /\b(top|best|leading)\s+\d{1,3}\b/i },
  { name: "list-of", re: /\b(list of|a list|curated list|directory of|roundup)\b/i },
  { name: "alternatives", re: /\b(alternatives?|competitors?)\s+(to|for|in)\b|\bvs\.?\s+\w+/i },
  { name: "comparison", re: /\b(compared|comparison|we tested|we reviewed|buyer'?s guide)\b/i },
  { name: "watchlist", re: /\b(companies|startups|tools|platforms)\s+to\s+(watch|know|follow)\b/i },
  { name: "jobs-board", re: /\b(jobs?|hiring|careers?|remote work)\s+(at|board|in)\b|\b\d+\s+jobs?\b/i },
  { name: "funding-list", re: /\b(portfolio|our investments|funded (startups|companies)|raised .{0,20}(seed|series))\b.*\b(list|companies|startups)\b/i },
  { name: "numbered-roundup", re: /^\s*\d{1,3}\+?\s+(best|top|leading|promising|funded|great)\b/i },
];

/** Registrable domains that read as a directory rather than a product. */
const DIRECTORY_DOMAIN = /(^|[.-])(vclist|saaslist|startuplist|toollist|directory|listings?|rankings?|reviews?|compare|alternatives)([.-]|$)/i;

/** Suffixes owned by investors and advisors, never by the product company. */
const NON_PRODUCT_TLD = /\.(vc|capital|ventures|partners|agency|consulting)$/i;

export type DirectoryVerdict = { isDirectory: boolean; reason: string | null };

/**
 * @param title   the search result's title
 * @param snippet the search result's description
 * @param url     the result URL
 */
export function looksLikeDirectory(
  title: string | null,
  snippet: string | null,
  url: string,
): DirectoryVerdict {
  const text = `${title ?? ""} ${snippet ?? ""}`.trim();

  for (const p of LISTICLE_PATTERNS) {
    if (p.re.test(text)) return { isDirectory: true, reason: p.name };
  }

  const domain = registrableDomain(url);
  if (domain && DIRECTORY_DOMAIN.test(domain.split(".")[0])) {
    return { isDirectory: true, reason: "directory-domain" };
  }
  if (domain && NON_PRODUCT_TLD.test(domain)) {
    return { isDirectory: true, reason: "investor-or-agency-tld" };
  }

  return { isDirectory: false, reason: null };
}
