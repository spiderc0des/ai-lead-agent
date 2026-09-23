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
  max_scrapes: z.number().int().min(1).max(200),
  /** Leads that may be saved with status `qualified`. */
  max_leads: z.number().int().min(1).max(50),
  /** Agent turns (tool-use round trips). */
  max_turns: z.number().int().min(1).max(200),
  /** Hard USD ceiling for this run's model spend. */
  max_budget_usd: z.number().min(0.05).max(25),
  /** Wall-clock ceiling; the run is aborted past this. */
  wall_clock_ms: z.number().int().min(60_000).max(3_600_000),

  /**
   * Stop after the ICP and wait for a person to approve it, before any
   * discovery or scraping happens.
   *
   * The ICP pass costs about $0.05; a full run costs $0.70 to $1.20. Checking
   * the criteria first is cheap insurance against spending the latter on a
   * misreading of the objective.
   */
  require_icp_confirmation: z.boolean().default(false),
});
// ^ Defaulted, not required: limits are frozen into runs.limits at creation,
// so every run stored before this field existed lacks it — and a strict parse
// made all of them impossible to load or resume. Absent means the run was
// created without the gate, so false is the truthful reading. New runs get
// true explicitly from DEFAULT_LIMITS. Any field added here later needs the
// same treatment.

export type RunLimits = z.infer<typeof RunLimitsSchema>;

/**
 * The turn cap is no longer a form field — it is a runaway guard, not a
 * choice anyone should have to make — so it is derived from the work the run
 * is allowed to do. Roughly: a turn per scrape batch and per qualification, a
 * few for drafting, plus headroom; capped at the schema maximum. The
 * outreach-safety guide requires a turn limit, so it stays enforced.
 */
export function deriveMaxTurns(limits: Pick<RunLimits, "max_scrapes" | "max_leads">): number {
  return Math.min(200, Math.max(40, 30 + Math.ceil(limits.max_scrapes * 1.5) + limits.max_leads * 3));
}

/**
 * Defaults tuned from real runs: verifying a headcount filter from public pages
 * rejects most candidates, so the pool has to be several times the target.
 */
export const DEFAULT_LIMITS: RunLimits = {
  max_candidates: 60,
  // Follows the candidate limit by default: every discovered company is read.
  max_scrapes: 60,
  max_leads: 10,
  max_turns: deriveMaxTurns({ max_scrapes: 60, max_leads: 10 }),
  max_budget_usd: 3,
  wall_clock_ms: 30 * 60 * 1000,
  require_icp_confirmation: true,
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
    .describe(
      "Must ALL be true for a lead to qualify. ONLY constraints the user actually stated, " +
        "plus the baseline that the company is a real operating business. Anything you " +
        "inferred belongs in soft_preferences — a filter the user never asked for silently " +
        "narrows their search and rejects leads they wanted.",
    ),
  soft_preferences: z
    .array(z.string())
    .describe("Improve fit but never disqualify on their own"),
  disqualifiers: z.array(z.string()).describe("Conditions that rule a company out"),

  /* --- provenance -------------------------------------------------------
   * Which parts of this ICP came from the person, and which the agent
   * supplied. A vague objective is filled in from the business context, which
   * is the right behaviour — but a reviewer has to be able to see where the
   * criteria came from, or an inferred constraint is indistinguishable from
   * one the user asked for.
   */
  user_stated: z
    .array(z.string())
    .describe(
      "Constraints taken directly from the objective, quoted or closely paraphrased. " +
        "For 'us business' this is just the geography. Must not be empty: an objective " +
        "that contributes nothing is one to ask about, not one to refine.",
    ),
  assumptions: z
    .array(z.string())
    .describe(
      "Everything you supplied that the user did not say, each with its reason — e.g. " +
        "'Assumed small/lean teams: Koya sells AI automation assistants to founders and " +
        "operators without dedicated ops staff.'",
    ),
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

/**
 * Words an objective cannot end on. A objective that stops on one of these was
 * cut off mid-thought — "companies with." is the case that prompted this — and
 * refusing it in the form is free, where finding out inside a run costs model
 * spend and possibly an Apify call.
 *
 * Deliberately a short closed list of function words, and nothing more. A
 * minimum word count was tried and rejected "us business" — two words, one
 * real constraint, and a case that must work — so brevity is not the signal.
 *
 * This is a convenience, not the guarantee: set_icp refusing an empty
 * user_stated is what actually stops a signal-free objective from becoming an
 * invented ICP.
 */
const DANGLING_TAIL =
  /\b(with|and|or|for|in|on|at|to|of|the|a|an|that|which|from|by|like|about)\s*[.,;:]?\s*$/i;

export const CreateRunSchema = z.object({
  objective: z
    .string()
    .min(10)
    .max(2000)
    .refine((v) => !DANGLING_TAIL.test(v.trim()), {
      message:
        "That objective looks cut off — it ends mid-phrase. Finish the sentence, " +
        "e.g. 'US agencies with manual client onboarding'.",
    }),
  limits: RunLimitsSchema.partial().optional(),
});
