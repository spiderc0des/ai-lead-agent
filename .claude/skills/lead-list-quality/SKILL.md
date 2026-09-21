---
name: lead-list-quality
description: Check the finished lead list against the quality scorecard before closing out a run. Use immediately before finalizing.
---


Use this guide to check the quality of the final lead list before submission.

## Required Checks

- The list contains 10 qualified companies.
- Each company has a name and domain.
- Each company has qualification reasoning.
- Each company has source context.
- Each company has outreach drafts.
- No personal email finding or email validation was attempted.
- Duplicate companies were removed.
- Companies marked `needs_review` are not counted as qualified leads.

## Suggested Scorecard

| Dimension | What To Check |
| --- | --- |
| ICP Fit | The lead matches the hard filters in the qualification objective. |
| Evidence Quality | The qualification decision uses real source context. |
| Duplicate Rate | The same company does not appear more than once. |
| Outreach Relevance | The email sequence uses company-specific context. |
| Data Completeness | Required fields are present in Supabase. |
| Safety Compliance | The agent did not find emails, validate emails, or send outreach. |

## Pass Standard

The submitted list should include 10 qualified companies that pass the core checks above.

If the agent cannot find 10 qualified companies from the first candidate pool, it should either search again within the tool-call limit or return fewer leads with a clear explanation.


---

## How to use this in a run

Call `mcp__lead__get_run_state` for the real counts, work through the scorecard, then submit it via `mcp__lead__finalize_run`.

**Your scorecard is not the last word.** The server independently re-checks the same things — lead count, duplicate domains, missing source context, incomplete outreach drafts — and if it disagrees with you it marks the run `needs_review` and records exactly why. An optimistic scorecard does not survive that; it just makes the mismatch part of the record a reviewer sees.

So report shortfalls plainly. If you found seven qualified leads instead of ten, say seven, and say what stopped you: candidates exhausted, scrape budget spent, too many companies that could not be verified. That is a useful result. A list padded to ten with `needs_review` companies relabelled as qualified is not, and the server will catch it.
