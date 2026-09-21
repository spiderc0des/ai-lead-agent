---
name: outbound-copywriting
description: Write a review-ready 3-step cold email sequence and a short LinkedIn message for a qualified lead, grounded in scraped company context. Use after a lead is saved as qualified.
---


Use this guide to create review-ready cold outreach drafts for qualified leads.

## Required Output

For each qualified lead, generate a 3-step cold email sequence.

Each step should include:

- Subject line
- Email body
- Personalization note

You may also generate a short LinkedIn message if your application supports it.

## Copy Rules

- Use the company context gathered during research.
- Keep each email short and direct.
- Write like a person, not a promotion.
- Do not invent details about the company.
- Avoid fake urgency, exaggerated claims, and generic praise.
- Do not include personal email addresses unless the user provided them.
- Do not send outreach.

## Suggested Sequence Structure

### Email 1

Open with a relevant observation from the company context, connect it to the offer, and ask a low-pressure question.

### Email 2

Add another relevant angle, such as a workflow bottleneck, scaling challenge, or operational pattern that connects to AI automation support.

### Email 3

Keep the final follow-up brief. Invite a reply if the timing or fit is wrong.

## Personalization

Good personalization references evidence:

- Website positioning
- Product or service category
- Audience served
- Hiring or scaling signal
- Public workflow or operational clue

Weak personalization is vague:

- "Loved what you are building"
- "Your company looks impressive"
- "I saw your website"

## Quality Check

Before finalizing copy, check:

- Does each email mention a real company-specific detail?
- Can each claim be traced to source context?
- Is the ask clear?
- Is the tone calm and credible?
- Would a human want to review this before sending?


---

## How to use this in a run

Call `mcp__lead__save_outreach_drafts` with all three email steps and the LinkedIn message in one call.

Each step carries an `evidence_url`, and it must be one of that lead's `source_urls`. This is the rule that keeps the copy honest: if you cannot point at the page a claim came from, the claim does not go in the email. The tool rejects drafts that cite anything else.

**What you are offering.** Koya Talent places trained AI automation assistants with founders, operators and agency owners — a person who automates repetitive workflows and builds internal AI-enabled systems, not a software product. Write accordingly: no feature lists, no "our platform".

**Hard rules the tool enforces.** No email address may appear anywhere in the copy, in any form. Nothing is ever sent; these are drafts for a human to review, edit, and decide on.

Before you submit, read email 1 back and ask whether it could have been sent to any other company on the list. If it could, the personalisation is not doing its job — go back to the source summary and find the specific detail.
