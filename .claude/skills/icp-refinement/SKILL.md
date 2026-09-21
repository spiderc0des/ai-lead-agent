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

If the objective is too vague to search, do not stop and ask — you have no interactive user. Choose a defensible reading, make it explicit in `business_problem` and `soft_preferences`, and say in your final summary what you assumed.
