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

## How this should actually sound

The guide says "write like a person, not a promotion". That is the rule most drafts break, and they break it while sounding perfectly competent. Judge a draft by whether a busy founder would believe a human typed it to them specifically.

**Subject lines.** A real person writes a subject that says what the email is about. Marketers write subjects that sell the benefit.

| Wrong | Why | Better |
| --- | --- | --- |
| Scaling Truffle's own support without adding headcount | A whitepaper title. Promises an outcome before saying anything. | quick question about Truffle's onboarding |
| Repeat-role customers, repeat internal work | Clever construction that means nothing until you read the body. | your repeat-roles page |
| Unlocking efficiency for lean teams | Pure category language. Could be sent to anyone. | Ashby + Breezy + Zapier |

Short, lowercase-ish, concrete. Naming the specific thing you noticed beats describing a benefit.

**Body.** Cut these on sight:

- **The diagnosis you cannot support.** "That kind of growth usually means someone is stretched across repetitive work." You do not know that. Say what you saw, then ask — do not tell them what is happening inside their company.
- **"I'd guess…"** followed by a paragraph about their operations. Guessing at length is still guessing.
- **The brochure sentence.** "Koya places trained AI automation assistants with early-stage teams like yours to take on exactly that kind of workflow." Nobody writes that to one person. Try: "I'm with Koya — we place AI automation assistants with teams around your size." Name Koya once, in email 1, as who you are; not as a brand to sell.
- **Stacked em-dash asides.** One per email at most. Three makes it an essay.
- **Tricolon lists.** "answering the same setup questions, triaging trial signups, prepping reporting" is a copywriter's rhythm, not speech.
- **"Worth a quick conversation about…"** and "happy to find 15 minutes". Just ask the question.

**Length.** Email 1 under 90 words. Two short paragraphs and a question is a complete email. If it needs a third paragraph, the observation is not specific enough.

**The ask.** One question, answerable in a sentence. "Is that actually a pain for you right now?" beats any offer of a meeting — a reply is the goal, not a booking.

**A worked example.** Same evidence, rewritten:

> **Subject:** Ashby + Breezy + Zapier
>
> Hi [Name],
>
> Saw on your About page that Truffle is self-funded and remote-first, with three people listed, and that you're wiring together Ashby, Breezy and Zapier.
>
> I'm with Koya — we place AI automation assistants with teams about that size, usually to take over the repetitive parts of onboarding and support. Is that actually where your time is going at the moment, or is it somewhere else?
>
> Best,
> [Your name]

Everything factual in it points at a page you read. Nothing claims to know how the company feels.

**Greeting and sign-off.** Every email opens `Hi [Name],` on its own line and ends with `[Your name]` on the last line. The run never looks up a contact, so the reviewer fills in both; "Hi —" reads like a mass mailing and a guessed name would be invented. The LinkedIn note opens `Hi [Name],` too. The tool rejects drafts without them.

**Every email needs its own detail, including the follow-ups.** Email 2 is where drafts go generic: "one pattern I see with small teams like yours…" fits every company on the list. Anchor it on a different fact from the pages you read — a specific open role, a named tool, a line from their pricing or onboarding page — and let the pattern follow from that fact. Email 3 may simply close the loop, but it still names the company.

**Never pitch them the workflow they sell.** Read what the company's product does before choosing what to offer help with. A customer-success platform built around health scores does not do health-score reviews by hand; an AI-agent company does not need to hear about AI. Suggesting otherwise lands as "we built a product for exactly that" and ends the thread. Pick the work around their product instead — hiring, onboarding their own customers, sales admin, content — and only what the page gives you a reason to mention.

**Time-sensitive facts.** Open roles, team counts and launch news go stale. Say what the page showed ("your careers page lists…"), not that it is true today, and name the page in the personalization note. The tool stamps each note with the date the page was read so the reviewer can check it is still current.

## How to use this in a run

Call `mcp__lead__save_outreach_drafts` with all three email steps and the LinkedIn message in one call.

Each step carries an `evidence_url`, and it must be one of that lead's `source_urls`. This is the rule that keeps the copy honest: if you cannot point at the page a claim came from, the claim does not go in the email. The tool rejects drafts that cite anything else.

**What you are offering.** Koya Talent places trained AI automation assistants with founders, operators and agency owners — a person who automates repetitive workflows and builds internal AI-enabled systems, not a software product. Write accordingly: no feature lists, no "our platform".

**Hard rules the tool enforces.** No email address may appear anywhere in the copy, in any form. Every email opens with a `[Name]` greeting and ends with `[Your name]`; email 1 names Koya; the LinkedIn message has its own `linkedin_personalization_note`. Nothing is ever sent; these are drafts for a human to review, edit, and decide on.

Before you submit, read each email back — email 2 especially — and ask whether it could have been sent to any other company on the list. If it could, the personalisation is not doing its job — go back to the source summary and find the specific detail.
