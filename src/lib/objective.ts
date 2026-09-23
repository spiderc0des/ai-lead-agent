/**
 * The objective a run is actually working to.
 *
 * When a run stops to ask, the person's answers become its objective and the
 * original wording moves to the log. That is safe by construction: a run only
 * asks when the original could not be searched — it said nothing usable,
 * contradicted who Koya sells to, or contradicted itself — so the answers
 * replace it rather than add to it.
 *
 * Derived from the log's `answered` events rather than stored in its own
 * column, so there is one record of what was said and no second copy to drift.
 */
export type QA = { question: string; answer: string };

export function composeObjective(original: string, answers: QA[]): string {
  const given = answers.map((a) => a.answer.trim()).filter(Boolean);
  return given.length ? given.join("; ") : original;
}

/**
 * How many leads the objective itself asks for — "Find 10 US B2B SaaS
 * companies…" -> 10. Used by the new-run form to fill in the Qualified leads
 * field as you type. The field is what the run records and the tool enforces;
 * this only pre-fills it, so the model never gets to set its own limit from
 * text.
 *
 * Deliberately narrow: a number right after a request verb, or right before a
 * company noun. "10 to 100 employees" is a headcount, not a count of leads, and
 * matches neither.
 */
export function leadCountFromObjective(objective: string): number | null {
  const verb = objective.match(
    /\b(?:find|get|give(?:\s+me)?|identify|list|source|pull|surface|show(?:\s+me)?)\s+(?:me\s+)?(?:up\s+to\s+)?(\d{1,3})\b(?!\s*(?:to|-|–)\s*\d)/i,
  );
  // Not the upper end of a range ("10-50", "10 to 50"), and not a size
  // ("50 employee companies" describes the companies, it does not count them).
  const nounMatch = objective.match(
    /(?<![-–]\s?|\bto\s)\b(\d{1,3})\s+(?:[\w&.-]+\s+){0,5}?(?:companies|leads|businesses|firms|agencies|startups|prospects|accounts)\b/i,
  );
  const noun = nounMatch && !/employee|staff|people|person|headcount|seat/i.test(nounMatch[0]) ? nounMatch : null;
  const n = Number((verb ?? noun)?.[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Pulls every answer out of a run's events, oldest round first. */
export function answersFromEvents(
  events: { kind: string; detail: unknown }[],
): QA[] {
  return events
    .filter((e) => e.kind === "answered")
    .flatMap((e) => ((e.detail as { answers?: QA[] } | null)?.answers ?? []));
}
