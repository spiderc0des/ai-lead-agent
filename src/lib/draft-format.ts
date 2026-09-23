import { NAME_PLACEHOLDER, SENDER_PLACEHOLDER, type OutreachInput } from "@/lib/schemas";

/**
 * The parts of the copywriting rules that are mechanical enough to check, so
 * they are checked rather than requested. Tone and relevance stay with the
 * skill and the human reviewer; these are the things a reviewer should never
 * have to fix by hand:
 *
 *   - a greeting with a visible [Name] slot, not "Hi —"
 *   - a [Your name] sign-off, so the email has a sender
 *   - Koya named in email 1, so the reader knows who is writing
 *
 * Returns one sentence per problem, written for the agent to act on.
 */
export function draftFormatProblems(drafts: Pick<OutreachInput, "emails" | "linkedin_message">): string[] {
  const problems: string[] = [];

  for (const e of [...drafts.emails].sort((a, b) => a.step_number - b.step_number)) {
    const lines = e.body.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    const first = lines[0] ?? "";
    const last = lines[lines.length - 1] ?? "";
    if (!first.includes(NAME_PLACEHOLDER)) {
      problems.push(
        `Email ${e.step_number} must open with a greeting on its own line that uses the ` +
          `${NAME_PLACEHOLDER} placeholder, e.g. "Hi ${NAME_PLACEHOLDER},". No contact is looked up, ` +
          `so the reviewer fills it in.`,
      );
    }
    if (!last.includes(SENDER_PLACEHOLDER)) {
      problems.push(`Email ${e.step_number} must end with a sign-off line of "${SENDER_PLACEHOLDER}".`);
    }
    if (e.step_number === 1 && !/\bKoya\b/.test(e.body)) {
      problems.push(
        `Email 1 must name Koya once (e.g. "I'm with Koya — we place…") so the reader knows who is writing.`,
      );
    }
  }

  if (!drafts.linkedin_message.includes(NAME_PLACEHOLDER)) {
    problems.push(`The LinkedIn message must open with "Hi ${NAME_PLACEHOLDER},".`);
  }

  return problems;
}
