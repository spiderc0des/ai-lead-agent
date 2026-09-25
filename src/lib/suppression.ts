import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { registrableDomain } from "@/lib/domain";

export const SUPPRESSION_REASONS = ["customer", "contacted", "excluded", "other"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

/** Why discovery skipped a domain, as it appears in the discard breakdown. */
export type SkipReason = `suppressed-${SuppressionReason}` | "qualified-earlier";

/**
 * Domains discovery must not add to this run, and why:
 *
 *   - the team's skip list (existing customers, already contacted, excluded)
 *   - any domain qualified in an EARLIER run, by anyone. Rediscovering it
 *     would spend shared Apify and model budget on an answer the team has.
 *
 * Read once per discover_companies call. Before 0011_suppression.sql the table
 * does not exist; discovery then runs as it always did rather than failing.
 */
export async function loadSkipDomains(runId: string): Promise<Map<string, SkipReason>> {
  const db = supabaseAdmin();
  const skip = new Map<string, SkipReason>();

  const [{ data: listed, error: listError }, { data: qualified }] = await Promise.all([
    db.from("suppressed_domains").select("domain, reason"),
    db.from("leads").select("company_domain").eq("qualification_status", "qualified").neq("run_id", runId),
  ]);
  if (listError && !/suppressed_domains/.test(listError.message)) {
    console.error("[suppression] could not read the skip list:", listError.message);
  }

  // Earlier qualifications first, so an explicit skip-list reason wins for a
  // domain that is in both.
  for (const q of qualified ?? []) {
    const d = registrableDomain(q.company_domain);
    if (d) skip.set(d, "qualified-earlier");
  }
  for (const row of listed ?? []) {
    skip.set(row.domain, `suppressed-${row.reason as SuppressionReason}`);
  }
  return skip;
}

/**
 * Turns what someone pasted — one per line, commas, full URLs, "www." — into
 * bare registrable domains. Returns the domains and anything it could not
 * read, so the caller can say which lines were ignored.
 */
export function parseDomainList(input: string): { domains: string[]; invalid: string[] } {
  const domains = new Set<string>();
  const invalid: string[] = [];
  for (const raw of input.split(/[\s,;]+/)) {
    const item = raw.trim();
    if (!item) continue;
    const d = registrableDomain(item.includes("://") ? item : `https://${item}`);
    if (d && d.includes(".")) domains.add(d);
    else invalid.push(item);
  }
  return { domains: [...domains], invalid };
}
