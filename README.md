# Lead Agent

AI lead research and outreach drafting, built on the **Claude Agent SDK**.

Enter a qualification objective; the agent refines it into ICP criteria,
discovers companies via Apify, reads their websites via Firecrawl, qualifies
them from evidence, and drafts a 3-step cold email sequence plus a LinkedIn
message for each qualified lead. Everything lands in Supabase for human review.

It never finds personal email addresses, never checks deliverability, and never
sends anything — there is no tool in the session that could.

`docs/` holds the one-pager and the testing-evidence queries. It is kept out of
version control on purpose, so it is not in this repository — ask the author
for a copy.

---

## Setup

### 1. Install

```bash
npm install
cp .env.example .env.local     # then fill it in
```

### 2. Supabase

Create a project, then run the three migrations in order in the SQL editor:

```
supabase/migrations/0001_init.sql       domain tables
supabase/migrations/0002_auth_rls.sql   profiles, admin role, RLS, realtime
supabase/migrations/0003_budget.sql     shared spend ledger
```

Put the project URL and both keys in `.env.local`. Two things that bite:

- `NEXT_PUBLIC_SUPABASE_URL` is the **bare** project URL — `https://x.supabase.co`,
  not `https://x.supabase.co/rest/v1/`. The client adds those paths itself.
- The service-role key is server-only and must never get a `NEXT_PUBLIC_` prefix.

Scripts read `.env.local` first and fall back to `.env`, the same precedence
Next.js uses.

Then three Auth settings that are easy to miss, and each fails quietly:

- **Authentication → URL Configuration** — add `<your app>/auth/confirm` to the
  redirect allowlist, including `http://localhost:3000/auth/confirm`. A link to
  an unlisted URL is rejected *after* the user clicks it.
- **Authentication → Providers → Email** — confirm the provider is enabled.
- **Authentication → Emails → SMTP Settings** — the built-in sender is a shared
  testing service with a low hourly cap and no delivery guarantee. Point it at
  Resend, SendGrid or Gmail SMTP before you rely on a link arriving.

If a link does not arrive, do not guess:

```bash
npm run auth:doctor -- you@company.com
```

It reads the real auth state (does the user exist, is the email confirmed, is
the profile there, is the role right) and then **mints a working sign-in link
and prints it**, so email delivery stops blocking you.

The `/auth/confirm` route accepts both callback shapes — PKCE `?code=` and
`?token_hash=&type=` — so it works whether or not you customise the email
template.

### 3. First admin

Signup is closed, so the first account has to be created out of band:

```bash
npm run seed:admin -- you@company.com
```

That invites the address if it does not exist and gives it the `admin` role.
The invite email doubles as a sign-in link. Everyone else is invited from
`/admin`.

### 4. Apify

Accept the team invite, then **switch to the team account in the Apify Console
before running anything** — runs bill to whichever account starts them. Use the
team API token in `APIFY_TOKEN`.

Check it before you spend anything real:

```bash
npm run verify:actor-input   # no token needed, no cost
npm run smoke:apify          # 1 query, 1 page, ~$0.002
```

`verify:actor-input` reads the actor's published input schema straight from
Apify's API and diffs it against what `buildActorInput()` sends. This matters
because Apify **silently ignores an input field it does not recognise** — a
renamed add-on toggle would leave that add-on running at its default, costing
money and, for the enrichment switches, surfacing email addresses the
outreach-safety guide forbids. Re-run it whenever the actor publishes a new
build, or if you point `APIFY_DISCOVERY_ACTOR` somewhere else.

`smoke:apify` refuses to proceed if the configured actor bills a flat monthly
rental fee. Open the run in the Console afterwards and confirm what it cost.

### 5. Firecrawl (optional but recommended)

Set `FIRECRAWL_API_KEY`. Without it, `scrape_websites` falls back to a raw fetch
plus HTML-to-text, and records which path it used.

```bash
npm run smoke:firecrawl
npm run smoke:firecrawl -- https://example.com/some-page
```

### 6. Run it

```bash
npm run verify:skills      # all five skills load into a session
npm run test:guards        # offline: injection handling, domain rules, URL guards
npm run dev
```

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `start` | Production build and serve |
| `npm run test:guards` | Offline guard tests — no keys, no network, no database |
| `npm run verify:skills` | Confirms all five skills load into an Agent SDK session |
| `npm run verify:actor-input` | Diffs our actor input against Apify's published schema — no token, no cost |
| `npm run smoke:apify` | One-page Apify run, prints the real cost |
| `npm run smoke:firecrawl` | Scrapes one URL and shows what the agent would receive |
| `npm run seed:admin -- <email>` | Creates/promotes an admin |
| `npm run auth:doctor -- <email>` | Why no sign-in link arrived — and prints one that works |

---

## Deployment

One container, one process: UI, API and the agent worker together. The agent
runs as a background task in the same Node process, so a serverless request
handler will not work — a full run takes many minutes.

```bash
docker build -t lead-agent \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
  --build-arg NEXT_PUBLIC_APP_URL=https://your-app.example .
```

### Railway, step by step

1. **New Project → Deploy from GitHub repo**, pick this repository. Railway
   detects the Dockerfile on its own; there is no build command to set.
2. **Variables.** Add everything from `.env.example`. The three `NEXT_PUBLIC_*`
   ones are inlined into the browser bundle at build time, which is why the
   Dockerfile declares them as `ARG` — Railway passes service variables through
   as build arguments.
3. **Settings → Networking → Generate Domain.** You cannot know the URL before
   the service exists, so this is a chicken-and-egg: deploy once, take the
   domain, set `NEXT_PUBLIC_APP_URL` to it, and redeploy. Magic links and the
   injection-honeypot URL both depend on it being right.
4. **Settings → Deploy → Replicas: 1.** Not optional. The run queue keeps each
   run's AbortController in memory and claims work with a conditional UPDATE
   that is only correct for a single process. Two replicas means two workers
   racing for the same runs, and Cancel only reaching whichever instance
   happens to hold it.
5. **Memory: 1 GB or more.** Each run spawns the Claude Code CLI as a
   subprocess alongside Next.js; 512 MB is tight.
6. **Health check path `/login`** — it is public and returns 200, where `/`
   redirects.
7. **Supabase → Authentication → URL Configuration**: add
   `https://<your-domain>/auth/confirm` to the redirect allowlist, or every
   sign-in link is rejected after it is clicked.

Then verify, in this order, because each one catches a different mistake:

```
https://<domain>/login                      200, and the form sends a link
https://<domain>/test/injection-honeypot    200 without signing in
```

If sign-in fails with a Supabase key error, the `NEXT_PUBLIC_*` variables were
missing at **build** time, not run time — set them and redeploy rather than
restart. If a run aborts immediately with "Skills failed to load", `.claude/`
did not make it into the image.

Other hosts (Render, Fly) work the same way: one long-lived container, one
replica, the same variables.

Two deployment details that matter:

- **`.claude/` must ship.** It holds the skills. The Dockerfile copies it
  explicitly and sets `AGENT_CWD=/app`. If it is missing, runs abort at startup
  with `Skills failed to load` rather than running skill-less.
- **Not a `standalone` build.** The Agent SDK spawns the Claude Code CLI and
  resolves a platform-specific binary at runtime, which the standalone tracer
  does not follow.

Add the deployed origin to Supabase's auth redirect allowlist.

---

## How spend is controlled

Three independent layers, none of which depend on the model behaving:

1. **Per-run limits** are frozen into the run record at creation. Each tool
   clamps against a count read back from Postgres before spending, so a restart
   or two concurrent calls cannot overshoot.
2. **A global ledger** caps Apify and model spend across *all* users. A run
   reserves its worst case before calling a paid API and settles the actual
   afterwards, inside a single-row conditional UPDATE — concurrent users
   serialise on the row lock.
3. **`maxBudgetUsd`, `maxTurns` and a wall-clock abort** bound the agent session
   itself.

Adjust the shared caps, or pause all new runs, from `/admin`.

## Project layout

```
.claude/skills/     five skills built from the project's guidance docs
src/agent/          the Agent SDK session, its tools, and the guards
src/lib/            Supabase clients, Apify, Firecrawl, schemas, domain rules
src/app/            UI and API routes
supabase/           SQL migrations
scripts/            smoke tests, guard tests, admin seeding
docs/               one-pager and testing evidence (untracked)
```
