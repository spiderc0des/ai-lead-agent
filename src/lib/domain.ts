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
