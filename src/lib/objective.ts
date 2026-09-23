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

/** Pulls every answer out of a run's events, oldest round first. */
export function answersFromEvents(
  events: { kind: string; detail: unknown }[],
): QA[] {
  return events
    .filter((e) => e.kind === "answered")
    .flatMap((e) => ((e.detail as { answers?: QA[] } | null)?.answers ?? []));
}
