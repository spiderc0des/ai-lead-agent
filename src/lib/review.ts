import { z } from "zod";

/**
 * A person's verdict on something the agent marked needs_review — one lead, or
 * a whole run. The agent's own status is never changed; the verdict sits
 * beside it, so the page shows both what the agent concluded and what the
 * reviewer decided.
 *
 * `decision: null` withdraws a verdict given by mistake.
 */
export const ReviewSchema = z.object({
  decision: z.enum(["good", "not_good"]).nullable(),
  note: z.string().trim().max(2000, "Keep the note under 2,000 characters").optional().default(""),
});

export type ReviewDecision = "good" | "not_good";

export const REVIEW_LABEL: Record<ReviewDecision, string> = {
  good: "Reviewed: good",
  not_good: "Reviewed: not good",
};

/** Postgres's message when 0010_reviews.sql has not been applied. */
export function isMissingReviewColumns(message: string): boolean {
  return /review_decision|review_note|reviewed_by|reviewed_at|run_events_kind_check/.test(message);
}
