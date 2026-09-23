---
name: icp-refinement
description: Turn a vague or broad qualification objective into concrete, searchable ICP criteria before spending any tool calls on discovery. Use at the start of every run, before searching.
---


Use this guide to turn a vague qualification objective into concrete ICP criteria before the agent searches for companies.

## Goal

The agent should understand who counts as a good-fit company before it spends tool calls on discovery and scraping.

## Minimum Criteria To Clarify

- Target company type
- Industry or niche
- Geography
- Company size or headcount range
- Relevant buyer or operator persona
- Business problem the company may have
- Hard disqualifiers
- Soft preferences

## Hard Filters vs Soft Preferences

Hard filters must be true for a lead to qualify.

Examples:

- Country must be United States
- Company must be B2B
- Headcount must be between 10 and 100

Soft preferences improve fit but should not automatically disqualify a company.

Examples:

- Recently hiring operations roles
- Uses tools that may connect to automation workflows
- Publishes content about scaling operations

## Output Format

The agent should produce a short ICP object before searching:

```json
{
  "target_company_type": "",
  "industries": [],
  "geography": [],
  "headcount_range": "",
  "buyer_persona": "",
  "business_problem": "",
  "hard_filters": [],
  "soft_preferences": [],
  "disqualifiers": []
}
```

## Rules

- Do not treat every user preference as a hard filter.
- Ask for clarification if the objective is too vague to search.
- Preserve specific constraints the user gives.
- Keep the ICP narrow enough to search, but not so narrow that the agent cannot find leads.


---

## How to use this in a run

Produce the ICP object above, then record it by calling `mcp__lead__set_icp` with those fields. Discovery is refused until it exists.

Two judgement calls decide whether the rest of the run works:

**What becomes a hard filter.** Only constraints the user actually stated. If they said "US B2B SaaS, 10-100 employees", those three are hard filters. If they said "companies that might need AI automation support", that is the business problem, not a filter — almost nothing would pass it as written.

**What you can actually verify.** You will qualify from public website evidence, so prefer filters a website can settle (country, what they sell, who they sell to) over ones it usually cannot (exact headcount, revenue, tech stack). Keep an unverifiable constraint as a hard filter if the user gave it, but expect to record it as a concern and lower confidence when the evidence runs out.

## Refining without inventing

You will usually get less than you need. Koya sells AI automation assistants to early-stage founders, operators and agency owners, so a thin objective is filled in from *that*, not from nothing. Doing so is correct. Hiding that you did it is not.

**Record where every criterion came from.** `user_stated` holds only what the objective actually said; `assumptions` holds everything you supplied, each with its reason. A reviewer must be able to tell the two apart, because an inferred constraint and a requested one look identical once they are both sitting in a list.

**Inferred constraints are soft preferences. Never hard filters.** This is the rule that decides whether the run finds what was asked for. A hard filter the user never stated silently rejects leads they wanted and they never find out why. `hard_filters` may contain only:

- constraints the user actually stated, and
- the one baseline: the company is a genuine operating business selling a product or service, not a directory, listicle, investor or job board.

Everything else — size, industry, stage, funding — goes in `soft_preferences`, where it raises confidence without excluding anyone.

### Worked example: `us business`

One constraint was stated. Everything else is inference.

```json
{
  "user_stated": ["Company operates in the United States"],
  "assumptions": [
    "Assumed small, founder-led teams: Koya places AI automation assistants with founders and operators who have no dedicated ops staff.",
    "Assumed agency, services and early-stage SaaS: these carry the repetitive client-facing workflows the offer addresses.",
    "Assumed the buyer personally handles operations, since that is who feels the problem."
  ],
  "hard_filters": [
    "Company is headquartered or primarily operating in the United States",
    "Company is a genuine operating business selling a product or service"
  ],
  "soft_preferences": [
    "Founder-led or owner-operated, with a small team page",
    "Digital agency, professional services, e-commerce ops, or early-stage SaaS",
    "Roughly 5-50 employees",
    "Few or no dedicated operations hires"
  ]
}
```

Compare that with putting *"appears early-stage or small/lean"* in `hard_filters`: the user never said it, and it would reject a 200-person agency that might be a perfectly good customer.

**On headcount.** When you are inferring a range rather than repeating one, do not start at 1. A solo operator has no team to take work off, which is what the offer does — it is a weaker fit than a 5-person team, not a stronger one. Prefer `5-50` over `1-50` unless the user asked for sole traders. When the user *does* state a range, use theirs exactly.

## When to stop and ask instead

Vague is normal and you refine it. **Too vague to search** is a different and much rarer thing, and it has a tool: `mcp__lead__request_clarification`, which ends the run without spending anything.

**The test is `user_stated`.** If nothing in the objective survives into `user_stated`, there is no signal and the ICP would be invention rather than inference. `mcp__lead__set_icp` refuses an empty `user_stated` for exactly that reason, so this is not a judgement you can talk yourself out of.

Ask only when one of these is true:

- **It contradicts the business.** "Fortune 500 banks", "consumers in Brazil" — no amount of inference reconciles that with who Koya sells to.
- **It is internally inconsistent.** "Enterprise companies with under 10 employees."
- **There is no signal at all, even with the business context applied.** "find companies", "leads please" — anything you wrote would be invention, not inference.

`us business` is none of these. One real constraint plus the business context is enough to write a defensible ICP, so refine it, record the assumptions, and proceed.

`companies with.` **is** the third case. It is truncated and states nothing — no geography, no industry, no size. Writing "assumed United States, assumed 5-50 employees, assumed agencies" is not refining a thin objective, it is authoring a different one and attributing it to the user. Call `mcp__lead__request_clarification` and stop. Do not call `set_icp`, and do not discover anything.

When you do ask, give two or three specific questions whose answers would make it searchable — not "can you be more specific".

## Turning the ICP into searches that find companies

This decides whether the run works at all. A search engine returns pages that *match your words*, and the words analysts use return articles, not companies.

**Search as a buyer would.** Name the software category and who it is for:

- `field service management software for small business` -> returned five real product companies on a live run
- `helpdesk software for ecommerce teams`
- `inventory management software for small manufacturers`

**Not as an analyst would.** These return listicles, VC portfolios and job boards, all of which are discarded before the agent sees them:

- `B2B SaaS companies with 10-100 employees`
- `best vertical SaaS startups 2026`
- `funded B2B SaaS companies`

Never use the words *companies*, *startups*, *list*, *best* or *top* in a query. If the ICP covers several verticals, give each its own query rather than one broad one — one category per query is what produces a usable pool.

So `industries` should be concrete enough to search: "field service management", "customer support tooling", "inventory management" beat "vertical SaaS".

If an objective is merely vague, refine it as above and say in your final summary what you assumed. If it meets one of the stop-and-ask conditions, call `mcp__lead__request_clarification` — see "When to stop and ask instead".
