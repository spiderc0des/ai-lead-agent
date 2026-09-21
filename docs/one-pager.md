# Lead Agent — how it works and how to use it

## What it does

You give it a qualification objective in plain English. It refines that into ICP
criteria, searches for companies, reads their websites, decides which ones fit,
and writes a 3-step cold email sequence plus a LinkedIn message for each
qualified lead. Everything it does is recorded in Supabase for review.

It stops at the draft. It does not find personal email addresses, does not check
deliverability, and cannot send anything — there is no tool in the session that
could.

## Using it

1. **Sign in** at `/login`. Access is invite-only: you get a magic link only if an
   admin has already created your account.
2. **Write an objective.** Be specific about the constraints that matter:
   *"Find 10 US B2B SaaS companies with 10 to 100 employees that may need AI
   automation support."* Anything you state becomes a hard filter; anything you
   leave out, the agent infers and records as a soft preference.
3. **Adjust limits** if you want to (candidates, scrapes, leads, turns, model
   budget). The defaults are sized for a 10-lead run.
4. **Start the run** and watch it. The run page updates live: refined ICP, every
   tool call, the candidate funnel, each qualification decision, and the drafts
   as they are written.
5. **Review and export.** When the run finishes, download the outreach sample
   pack (Markdown) or the lead list (CSV).

One run per person at a time — the workers are shared.

## How it works

A **Claude Agent SDK** session drives the whole thing. The agent decides which
tool to call and when; the application decides what those tools are allowed to
do.

**Seven tools**, exposed through an in-process MCP server:

| Tool | What it does |
| --- | --- |
| `set_icp` | Records refined ICP criteria. Discovery is refused until this exists. |
| `discover_companies` | Apify web search. Caps pages, drops directories and job boards, de-dupes by domain. |
| `scrape_websites` | Firecrawl (or a raw-fetch fallback). Returns sanitised text in an untrusted-content block. |
| `save_lead` | One qualification decision, with evidence. Rejects a qualified lead with no scraped sources. |
| `save_outreach_drafts` | 3 emails + a LinkedIn message. Each email must cite a URL from that lead's sources. |
| `get_run_state` | Current counts against every limit. |
| `finalize_run` | Closes the run. The server re-checks the list independently. |

**Five skills**, built from the project's guidance docs and loaded from
`.claude/skills/`: `icp-refinement`, `lead-qualification`,
`outbound-copywriting`, `lead-list-quality`, `outreach-safety`. The run aborts at
startup if any of them fails to load, rather than running without them.

**No other tools exist in the session.** `tools: ["Skill"]` removes every
built-in — no shell, no file access, no general web fetch.

## How the limits are enforced

Not by the prompt. Limits are frozen into the run record when it is created, and
every tool clamps against a count read back from Postgres before it spends
anything. When a tool refuses, the agent is told the refusal is final.

Apify and Anthropic spend draw on **one pool shared by every user**. A run
reserves its worst-case cost against that pool before calling a paid API and
settles the actual afterwards, all inside a single-row Postgres update — so two
people starting runs at the same moment cannot both claim the last cent. The
admin console shows the ledger.

## Untrusted web content

Scraped text is data, never instruction. Three layers:

1. Content is wrapped in a labelled block it cannot escape — the delimiter is
   neutralised in the page text before wrapping.
2. Injection attempts are detected, marked inline where the model reads them,
   and recorded on the `page_sources` row so a reviewer can see what was tried.
   Flagged lines are kept, not deleted.
3. Most importantly, there is nothing for an injected instruction to reach: no
   send tool, no email lookup, no shell, and limits that live in the database.

`/test/injection-honeypot` serves a fixture page that attempts all of it.

## Who can see what

Each person sees only their own runs. Admins see everything. This is enforced by
Postgres row-level security, not by application code — the browser holds the
anon key and every query is filtered by `user_id = auth.uid() or is_admin()`.

There are **no insert, update or delete policies at all**. The browser can read;
only the server, using the service-role key, can write. A signed-in user cannot
fabricate a lead or forge a tool-call log.

## What gets stored

`runs` (objective, refined ICP, limits, status, cost, turns) · `candidates` (the
discovery pool) · `page_sources` (every scraped page, with injection flags) ·
`leads` (status, confidence, fit reasons, concerns, sources, summary) ·
`outreach_drafts` (3 emails + LinkedIn, each with its evidence URL) ·
`tool_calls` (every call, including denied and limit-blocked ones) ·
`budget_ledger` (every reserve, settle and release).
