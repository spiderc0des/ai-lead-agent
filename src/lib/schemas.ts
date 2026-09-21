import { z } from "zod";

/* -------------------------------------------------------------------------
 * Run limits
 *
 * Frozen into runs.limits when the run is created. The agent never sees a
 * writable copy: every cap is clamped inside the tool handler that spends it.
 * ---------------------------------------------------------------------- */

export const RunLimitsSchema = z.object({
  /** Candidate companies that may enter the discovery pool. */
  max_candidates: z.number().int().min(1).max(200),
  /** Websites that may be scraped. */
  max_scrapes: z.number().int().min(1).max(100),
  /** Leads that may be saved with status `qualified`. */
  max_leads: z.number().int().min(1).max(50),
  /** Agent turns (tool-use round trips). */
  max_turns: z.number().int().min(1).max(200),
  /** Hard USD ceiling for this run's model spend. */
  max_budget_usd: z.number().min(0.05).max(25),
  /** Wall-clock ceiling; the run is aborted past this. */
  wall_clock_ms: z.number().int().min(60_000).max(3_600_000),
});

export type RunLimits = z.infer<typeof RunLimitsSchema>;

/**
 * Defaults tuned from the first real run, which spent $0.85 and 54 of 60 turns
 * while reaching only 14 companies and one qualified lead. Verifying a
 * headcount filter from public pages rejects most candidates, so the pool has
 * to be several times the target and the turn budget has to leave room for
 * drafting after all that qualification.
 */
export const DEFAULT_LIMITS: RunLimits = {
  max_candidates: 60,
  max_scrapes: 45,
  max_leads: 10,
  max_turns: 140,
  max_budget_usd: 3,
  wall_clock_ms: 30 * 60 * 1000,
};

/* -------------------------------------------------------------------------
 * ICP — shape taken verbatim from assets/icp-refinement-guide.md
 * ---------------------------------------------------------------------- */

export const IcpShape = {
  target_company_type: z
    .string()
    .min(3)
    .describe("e.g. 'B2B SaaS company selling to mid-market ops teams'"),
  industries: z.array(z.string()).min(1).describe("Industries or niches in scope"),
  geography: z.array(z.string()).min(1).describe("Countries or regions in scope"),
  headcount_range: z
    .string()
    .describe("e.g. '10-100 employees'. Use 'unspecified' if the user gave none."),
  buyer_persona: z.string().describe("The operator or buyer who would feel this problem"),
  business_problem: z
    .string()
    .describe("The operational problem that makes AI automation support relevant"),
  hard_filters: z
    .array(z.string())
    .describe("Must ALL be true for a lead to qualify. Keep this list short."),
  soft_preferences: z
    .array(z.string())
    .describe("Improve fit but never disqualify on their own"),
  disqualifiers: z.array(z.string()).describe("Conditions that rule a company out"),
} as const;

export const IcpSchema = z.object(IcpShape);
export type Icp = z.infer<typeof IcpSchema>;

/* -------------------------------------------------------------------------
 * Lead — shape taken verbatim from assets/lead-qualification-guide.md
 * ---------------------------------------------------------------------- */

export const QUALIFICATION_STATUSES = [
  "qualified",
  "not_qualified",
  "needs_review",
] as const;

export const LeadShape = {
  company_name: z.string().min(1),
  company_domain: z
    .string()
    .min(3)
    .describe("Bare registrable domain, e.g. 'acme.com' — no scheme, no path"),
  qualification_status: z.enum(QUALIFICATION_STATUSES),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("0-1. Lower it when a hard filter could not be verified from evidence."),
  fit_reasons: z
    .array(z.string())
    .describe("Plain-language reasons, each traceable to scraped source content"),
  concerns: z
    .array(z.string())
    .describe("What is unverified, ambiguous, or argues against fit"),
  source_urls: z
    .array(z.string().url())
    .min(1)
    .describe("URLs actually scraped for this company. Required — no evidence, no lead."),
  source_summary: z
    .string()
    .min(20)
    .describe("What the sources actually say about the company, in your own words"),
} as const;

export const LeadSchema = z.object(LeadShape);
export type LeadInput = z.infer<typeof LeadSchema>;

/* -------------------------------------------------------------------------
 * Outreach — shape from assets/outbound-copywriting-guide.md
 * ---------------------------------------------------------------------- */

export const EmailStepSchema = z.object({
  step_number: z.number().int().min(1).max(3),
  subject: z.string().min(3),
  body: z.string().min(20),
  personalization_note: z
    .string()
    .min(10)
    .describe("Which specific company detail this email leans on, and where it came from"),
  evidence_url: z
    .string()
    .url()
    .describe("Must be one of this lead's source_urls — the claim's provenance"),
});

export const OutreachShape = {
  company_domain: z.string().min(3).describe("The qualified lead to attach these drafts to"),
  emails: z.array(EmailStepSchema).length(3).describe("Exactly three sequence steps"),
  linkedin_message: z
    .string()
    .min(20)
    .max(600)
    .describe("Short connection note. Same evidence rules as the emails."),
} as const;

export const OutreachSchema = z.object(OutreachShape);
export type OutreachInput = z.infer<typeof OutreachSchema>;

/* -------------------------------------------------------------------------
 * Quality scorecard — from assets/lead-list-quality-guide.md
 * ---------------------------------------------------------------------- */

export const ScorecardShape = {
  summary: z
    .string()
    .min(30)
    .describe("What was found, and anything a human reviewer should know"),
  icp_fit: z.string(),
  evidence_quality: z.string(),
  duplicate_rate: z.string(),
  outreach_relevance: z.string(),
  data_completeness: z.string(),
  safety_compliance: z.string(),
} as const;

export const ScorecardSchema = z.object(ScorecardShape);

/* -------------------------------------------------------------------------
 * Objective (user input)
 * ---------------------------------------------------------------------- */

export const CreateRunSchema = z.object({
  objective: z.string().min(10).max(2000),
  limits: RunLimitsSchema.partial().optional(),
});
