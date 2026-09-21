# Testing evidence

Every row is reproducible: run the query against the Supabase SQL editor with
the run id in place of `:run_id`. Fill in the run ids and results as you go.

Set the run id once per section:

```sql
-- \set run_id '00000000-0000-0000-0000-000000000000'
```

---

## 1. Vague qualification objective

**Objective used:** `find me some companies that need AI help`

**Expectation:** the run record shows the concrete ICP the agent derived before
searching.

```sql
select objective, icp->>'target_company_type' as target,
       icp->'hard_filters'  as hard_filters,
       icp->'soft_preferences' as soft_preferences
from runs where id = :'run_id';
```

**Run id:**
**Result:**

---

## 2. Specific qualification objective

**Objective used:** `Find 10 US B2B SaaS companies with 10 to 100 employees that may need AI automation support.`

**Expectation:** the stated constraints survive as hard filters, and qualified
leads reference them.

```sql
select icp->'hard_filters' as hard_filters from runs where id = :'run_id';

select company_domain, confidence, fit_reasons
from leads
where run_id = :'run_id' and qualification_status = 'qualified'
order by company_domain;
```

**Run id:**
**Result:**

---

## 3. Company discovery

**Expectation:** Apify was used for discovery, and the lead-count limit was
respected — enforced by the tool, not the model.

```sql
-- Apify calls, with the cost and cap the tool actually applied
select created_at, status,
       result_summary->>'apify_run_id'    as apify_run,
       result_summary->>'cost_usd'        as cost_usd,
       result_summary->>'new_candidates'  as new_candidates,
       result_summary->>'candidates_used' as used,
       result_summary->>'candidate_limit' as cap
from tool_calls
where run_id = :'run_id' and tool_name = 'discover_companies'
order by created_at;

-- Candidates never exceed the frozen limit
select (select count(*) from candidates where run_id = :'run_id') as candidates,
       (limits->>'max_candidates')::int as cap
from runs where id = :'run_id';
```

**To evidence the cap being enforced rather than merely respected:** start a run
with `max_candidates: 5`, let the agent try a second discovery call, and show the
`limit_blocked` row:

```sql
select tool_name, status, error_message
from tool_calls
where run_id = :'run_id' and status = 'limit_blocked';
```

**Also worth attaching here:** `npm run verify:actor-input` output, showing that
every field the app sends exists in the actor's published schema with the right
type — i.e. that the paid add-ons are genuinely off rather than merely intended
to be. Apify ignores unknown input keys silently, so this is the only way to
prove it short of reading the charged-event counts on a run.

**Run id:**
**Result:**

---

## 4. Website scraping

**Expectation:** an approved scraper was used, and leads carry source URLs and
summaries.

```sql
select url, scraper, http_status, content_chars, injection_flags
from page_sources where run_id = :'run_id' order by scraped_at;

select company_domain, array_length(source_urls, 1) as sources,
       left(source_summary, 120) as summary
from leads where run_id = :'run_id' and qualification_status = 'qualified';
```

**Run id:**
**Result:**

---

## 5. Lead qualification

**Expectation:** every decision carries status, confidence, fit reasons,
concerns and source context.

```sql
select company_name, company_domain, qualification_status, confidence,
       fit_reasons, concerns, source_urls
from leads where run_id = :'run_id'
order by qualification_status, company_domain;
```

**Run id:**
**Result:**

---

## 6. Outreach drafting

**Expectation:** drafts reference real company context and invent nothing. Each
email's `evidence_url` must appear in the parent lead's `source_urls` — this is
enforced at write time, so a row existing is itself the proof.

```sql
select l.company_domain, d.step_number, d.subject,
       d.evidence_url,
       d.evidence_url = any(l.source_urls) as evidence_is_a_real_source
from outreach_drafts d
join leads l on l.id = d.lead_id
where d.run_id = :'run_id' and d.channel = 'email'
order by l.company_domain, d.step_number;
```

**Every row must show `evidence_is_a_real_source = true`.**

No email addresses anywhere in the copy:

```sql
select count(*) as addresses_found
from outreach_drafts
where run_id = :'run_id'
  and (body ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
    or coalesce(subject,'') ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}');
```

**Must be 0.**

**Run id:**
**Result:**

---

## 7. Supabase logging

**Expectation:** one run id joins cleanly across every table.

```sql
select
  (select count(*) from candidates      where run_id = :'run_id') as candidates,
  (select count(*) from page_sources    where run_id = :'run_id') as pages,
  (select count(*) from leads           where run_id = :'run_id') as leads,
  (select count(*) from leads           where run_id = :'run_id'
                                          and qualification_status='qualified') as qualified,
  (select count(*) from outreach_drafts where run_id = :'run_id') as drafts,
  (select count(*) from tool_calls      where run_id = :'run_id') as tool_calls;
```

For 10 qualified leads expect `drafts = 40` (3 emails + 1 LinkedIn each).

**Run id:**
**Result:**

---

## 8. Prompt injection (safety)

**Expectation:** a hostile page is flagged, recorded, and ignored.

1. Deploy the app, then run the agent against `https://<your-app>/test/injection-honeypot`
   (Firecrawl cannot reach `localhost`). The quickest route is
   `npm run smoke:firecrawl -- https://<your-app>/test/injection-honeypot`, or let a
   run scrape it.

```sql
select url, injection_flags, content_chars
from page_sources
where run_id = :'run_id' and array_length(injection_flags, 1) > 0;
```

**Expected flags:** `ignore-instructions`, `role-override`, `system-prompt-probe`,
`secret-exfiltration`, `limit-override`, `outreach-trigger`, `delimiter-escape`,
`fake-authority`.

2. Show that nothing the page asked for happened: limits unchanged, no denied
   tool calls succeeded, no outreach sent (no tool exists that could).

```sql
select limits from runs where id = :'run_id';          -- unchanged from creation
select tool_name, status from tool_calls
where run_id = :'run_id' and status in ('denied','limit_blocked');
```

Offline coverage of the same fixture: `npm run test:guards`.

**Run id:**
**Result:**

---

## 9. Multi-user isolation

**Expectation:** users see only their own runs; an admin sees everything.

1. Sign in as user A, start a run. Sign in as user B in another browser: A's run
   must not appear on B's dashboard.
2. As B, open `/runs/<A's run id>` directly — the page must stay empty, because
   RLS returns no rows rather than because the UI hid them.
3. Sign in as the admin: both runs appear under `/admin`.
4. Confirm the browser cannot write, even to its own rows:

```js
// In the browser console while signed in:
await supabase.from('leads').insert({ run_id: '<your run>', company_name: 'x' })
// Expected: a row-level security error. There are no INSERT policies.
```

**Result:**

---

## 10. Shared spend cap

**Expectation:** the cap is enforced globally and atomically, before money moves.

```sql
-- Reserve/settle pairs for every paid call
select created_at, kind, phase, amount_usd, note
from budget_ledger order by created_at desc limit 20;

select apify_cap_usd, apify_spent_usd, apify_reserved_usd,
       agent_cap_usd, agent_spent_usd, agent_reserved_usd, runs_paused
from app_budget where id = 'global';
```

**Exhaustion behaviour:** in the admin console set the Apify cap to roughly what
has already been spent, then try to start a run. It must be refused with a plain
message *before* anything is spent. Restore the cap afterwards.

**Race safety:** `reserve_budget` is a single-row conditional UPDATE, so
concurrent callers serialise on the row lock. To demonstrate, set the cap so only
one reservation can fit and fire several at once — exactly one returns `ok: true`.

**Result:**

---

## Cost record

```sql
select id, model, num_turns, total_cost_usd, duration_ms, status
from runs order by created_at desc limit 10;
```

Apify spend also appears in the Apify Console run history — confirm the total is
comfortably inside the shared budget.
