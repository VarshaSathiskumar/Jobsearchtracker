# Job Tracker

A private, single-user web app that connects to your Gmail (read-only), uses a LangChain multi-agent
pipeline to classify job-related email, and keeps a database-backed dashboard of applications,
rejections, callbacks, interviews and job alerts. A **Refresh Now** button runs a durable background sync.

- Next.js 16 (App Router), TypeScript, React 19, Tailwind CSS 4, shadcn/ui, Lucide, Recharts
- Auth.js (Google sign-in, single-email allowlist enforced server-side)
- Gmail API over OAuth 2.0 with the `gmail.readonly` scope only, offline access
- Supabase Postgres via Drizzle ORM (migrations included)
- LangChain JS (`langchain` v1 `createAgent`, `@langchain/anthropic`): supervisor agent with specialist subagents as tools
- Vercel Workflow SDK for durable, chunked, resumable sync execution
- Zod for every structured LLM output
- Vitest unit and integration tests (real Postgres engine via PGlite, real LangChain agent wiring)

No AWS, no EventBridge and no scheduled sync: syncs only run when you click Refresh Now (or start a backfill).

---

## What needs your own credentials

Nothing external was available while building this, so everything below is implemented and tested
against fakes, and needs you to supply real accounts before it works end to end:

| Integration | You must provide | Where |
|---|---|---|
| Google Cloud OAuth client | Client ID and secret, consent screen, Gmail API enabled | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Supabase project | Pooled and direct Postgres URLs | `DATABASE_URL`, `DIRECT_DATABASE_URL` |
| Anthropic | API key | `ANTHROPIC_API_KEY` |
| Vercel | A project (Workflow runs on Vercel's managed world in production) | Vercel dashboard |

Verified without credentials: unit tests, integration tests (sync pipeline, agents, API authorization),
`next build`, lint, type check, and a local run of the UI against a local database with a hand-made session.
Not verified: a live Gmail fetch, a live Anthropic call, Vercel deployment.

---

## Quick start (local)

```bash
npm install
npm run secrets          # prints AUTH_SECRET and TOKEN_ENCRYPTION_KEY, paste into .env
cp .env.example .env     # if you do not already have .env, then fill in the values
npm run db:migrate       # applies ./drizzle migrations to DIRECT_DATABASE_URL
npm run dev              # http://localhost:3000
```

All configuration lives in a single `.env` file at the project root (git-ignored). Next.js, drizzle-kit
and the migration script all read it. `.env.example` documents every variable.

Optional: no Supabase yet? Run a throwaway local Postgres (PGlite) instead:

```bash
npm run db:local         # terminal 1, listens on 127.0.0.1:5433
# in .env:
# DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres
# DB_POOL_MAX=1
npm run dev              # terminal 2
```

Then sign in, open Settings and use **Load sample data** to explore the UI. Sample rows are labelled
"Sample" everywhere and are removed with one click, so they never blend with real Gmail records.

### Scripts

| Script | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Vitest (unit + integration) |
| `npm run typecheck` / `lint` | `tsc --noEmit` / ESLint |
| `npm run db:generate` | Generate a new migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:local` | Local PGlite Postgres for development |
| `npm run secrets` | Generate `AUTH_SECRET` and `TOKEN_ENCRYPTION_KEY` |

---

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `APP_URL` | yes | Public base URL, e.g. `http://localhost:3000` or `https://your-app.vercel.app`. Used for OAuth redirect URIs. |
| `AUTH_SECRET` | yes | Signs Auth.js sessions. `npm run secrets`. |
| `TOKEN_ENCRYPTION_KEY` | yes | 32 random bytes, base64. Encrypts Gmail refresh tokens (AES-256-GCM). Losing it means reconnecting Gmail. |
| `ALLOWED_EMAIL` | yes | The only Google account that may sign in. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | yes | One OAuth client serves sign-in and the Gmail connection. |
| `DATABASE_URL` | yes | Supabase **pooled** URL (transaction mode, port 6543). |
| `DIRECT_DATABASE_URL` | for migrations | Supabase direct URL (port 5432). |
| `ANTHROPIC_API_KEY` | yes for agents | Without it syncs still ingest mail, but the agent step fails and mail stays pending. |
| `ANTHROPIC_MODEL_SUPERVISOR` | no | Default `claude-sonnet-5-5`. |
| `ANTHROPIC_MODEL_FAST` | no | Default `claude-haiku-5-5`. Used for classification and extraction. |
| `SYNC_LIST_PAGE_SIZE`, `GMAIL_CONCURRENCY`, `AGENT_BATCH_SIZE`, `AGENT_BATCHES_PER_STEP`, `SYNC_STALE_LOCK_MINUTES`, `MAX_MESSAGE_ATTEMPTS`, `DB_POOL_MAX` | no | Tuning, see `src/env.ts`. |

---

## Google Cloud setup (Gmail API and OAuth)

1. Go to <https://console.cloud.google.com/>, create a project (e.g. "Job Tracker").
2. **APIs & Services > Library**: enable **Gmail API**.
3. **APIs & Services > OAuth consent screen** (Google Auth Platform):
   - User type **External** (or **Internal** if you use a Google Workspace account, which avoids most limits below).
   - Add scopes: `openid`, `email`, `profile`, and `https://www.googleapis.com/auth/gmail.readonly`.
   - While in **Testing**, add your Gmail address under **Test users**.
4. **Credentials > Create credentials > OAuth client ID > Web application**. Add **Authorized redirect URIs**:
   - `http://localhost:3000/api/auth/callback/google` (sign-in, local)
   - `http://localhost:3000/api/gmail/callback` (Gmail connection, local)
   - `https://YOUR-DOMAIN/api/auth/callback/google` (sign-in, production)
   - `https://YOUR-DOMAIN/api/gmail/callback` (Gmail connection, production)
5. Copy the client ID and secret into `.env`.

There are two distinct consent steps by design. Signing in only proves identity (`openid email profile`).
Gmail access is requested separately from **Settings > Connect Gmail** with `access_type=offline`,
`prompt=consent`, PKCE and a state cookie, and only ever for `gmail.readonly`. The app refuses to store a
credential if Google reports any additional scope.

### Testing vs Production, refresh tokens and verification

- **Testing status (External)**: only listed test users can authorize, and Google expires refresh tokens
  after **7 days**. When that happens the top bar shows **Reconnect Gmail** (the app marks the connection
  `needs_reauth` on `invalid_grant`). Reconnecting takes one click. This is the simplest option for a personal tool.
- **In production, unverified**: removes the 7 day expiry but users see an "unverified app" warning and
  Google caps unverified apps at 100 users. Fine for one person.
- **Verification**: `gmail.readonly` is a *restricted* scope. Public apps that store Gmail data on servers
  generally need Google verification and a third party security assessment (CASA). A single-user personal
  deployment does not need to go through this, but check Google's current policy pages before relying on it
  because these rules change.
- **Workspace Internal** apps skip verification and the 7 day expiry.
- If you ever see "Google did not return a refresh token", remove the app at
  <https://myaccount.google.com/permissions> and connect again.

Refresh tokens are encrypted at rest with AES-256-GCM (`src/lib/crypto.ts`), decrypted only inside server
code to mint short lived access tokens, cached in memory per run, never sent to the browser and scrubbed from
logs (`src/lib/log.ts`). **Disconnect** asks Google to revoke the token and deletes the stored ciphertext.

---

## Supabase setup

1. Create a project at <https://supabase.com/>.
2. **Project Settings > Database > Connection string**:
   - `DATABASE_URL`: the **transaction pooler** string (port 6543). Prepared statements are disabled in code for compatibility.
   - `DIRECT_DATABASE_URL`: the direct string (port 5432), or the session pooler string if your network lacks IPv6.
3. Run `npm run db:migrate`.
4. Row Level Security: the app talks to Postgres directly from the server with a privileged role and never exposes the
   Supabase anon key. Do not add the Supabase client to the browser. If you enable the Data API, enable RLS on these tables
   (with no policies) so that they are not reachable through it.

### Schema

`users`, `gmail_connections`, `gmail_messages`, `applications`, `application_events`, `job_alerts`,
`review_items`, `sync_runs`, `dashboard_summaries` (see `src/db/schema.ts`, SQL in `drizzle/`).
Key constraints:

- `gmail_messages (user_id, gmail_message_id)` unique: deduplication by Gmail ID, thread IDs persisted.
- `applications (user_id, dedupe_key)` unique: one record per company plus job id (or normalized title).
- `application_events (application_id, gmail_message_id)` unique where not null: an email can only ever add one event to an application, so retries are idempotent.
- `sync_runs` partial unique index on `(user_id)` where status is `queued` or `running`: the **durable sync lock**.
- Only the Gmail snippet and metadata are stored. The body excerpt the agents need is a transient working copy that is cleared as soon as a message is processed.

---

## Vercel deployment

1. Push the repository to GitHub and import it in Vercel (framework: Next.js).
2. Add every variable from `.env.example` under **Settings > Environment Variables** (Production, and Preview if wanted).
   Set `APP_URL` to the production URL.
3. Add the production redirect URIs from the Google step above.
4. Deploy. `next.config.ts` wraps the app with `withWorkflow`, so the Workflow SDK builds its routes
   (`/.well-known/workflow/...`) automatically and Vercel runs workflow steps on its managed world.
5. Run migrations against Supabase from your machine (`npm run db:migrate`) before first use.
6. Sign in, open **Settings > Connect Gmail**, then click **Refresh Now**.

Function duration: each workflow step is bounded (one Gmail page, or one or two agent batches, with a 150 s
time budget) so it fits default Fluid compute limits. Raise `maxDuration` in the Vercel project settings if you
increase batch sizes.

---

## How sync works

`POST /api/sync` (authenticated, same-origin) creates a `sync_runs` row (taking the durable lock), starts the
`syncWorkflow` via the Workflow SDK, stores the workflow run id and returns `{ runId }` immediately (HTTP 202).
A second click while a run is active returns HTTP 409 with the active `runId`, and the UI simply follows that run.
Runs whose heartbeat stopped for 15 minutes are released automatically, so a crashed run can never block syncing.

The UI polls `GET /api/sync/:id` every 1.5 s, shows scanned/added/updated/pending-review counters, and refreshes
the dashboard when the run finishes. Because the run lives in the database, progress keeps updating after a page
reload and the work continues if the tab is closed.

```
workflow steps (each bounded, retried, idempotent)
  markRunning
  ingest x N        Gmail ids -> metadata -> deterministic prefilter -> bodies only for plausible mail -> gmail_messages
  processMail x N   LangChain supervisor over batches of pending messages
  summarize         verified counts from SQL, narrative from the Summary Agent
  finalize          completed | partial, lastSyncedAt
```

**Ingestion**
- Initial run is a **historical backfill**: `messages.list` pages (100 per step) with an optional date range, using a job-related search query. Progress (`pageToken`, scanned count, anchor history id) is saved after every page in `gmail_connections.backfill_state`, so an interrupted backfill resumes from the last page, even in a brand new run.
- The history id is **committed only after the messages are durably stored**. For a backfill the anchor is captured *before* listing, so mail that arrives during the backfill is picked up by the first incremental sync.
- Later syncs use `history.list` from the committed history id. If Gmail says the id expired (HTTP 404), the run becomes a **rescan** of the period since the last sync (minus a margin). Deduplication makes the overlap harmless.
- Gmail calls use bounded concurrency (default 5), exponential backoff with jitter, `Retry-After` support, and retry on 429/5xx and rate-limit 403s.

**Run states**: `queued`, `running`, `completed`, `partial` (something was ingested but errors or pending mail remain, resumable), `failed`.

---

## Multi-agent design

```
Supervisor (createAgent, sees only opaque message ids)
 |- classification_agent  -> Zod: category + confidence (deterministic shortcut for known job-alert senders)
 |- application_agent     -> company, title, date, job id, source; deterministic upsert, no duplicates
 |- response_agent        -> outcome + candidate lookup tool; deterministic matcher has the last word
 `- job_alerts_agent      -> roles + links, stored apart from applications, URLs must exist in the email
Summary Agent (separate step) -> narrative only; every number comes from SQL
```

Each subagent is a real `createAgent` with a focused prompt, optional read-only tools and `toolStrategy(zodSchema)`
structured output. Agents only **propose**. Deterministic code (`src/lib/pipeline/handlers.ts`) validates, applies
confidence thresholds, matches applications, applies status rules and writes inside transactions.

Safety properties, each covered by tests:
- **A rejection for one role cannot reject another role at the same company.** The matcher uses job id, email thread and title. A company-only match is allowed only when the company has exactly one application and the email does not contradict its title. Otherwise the email goes to **Needs Review**. An LLM proposal is accepted only if it is one of the code-supplied candidates, is at the same company, has at least 0.8 confidence **and** has corroborating evidence.
- **Status history is complete and order independent.** Status is derived from all events sorted by time, with forward-only transitions, terminal rejection/withdrawal (reopened only by a later confident offer or interview) and manual edits that always win. Callbacks and scheduled interviews are separate statuses.
- **Emails are untrusted data.** They are wrapped in delimiters the email cannot close, the supervisor never sees email text, tool results are data, and tools are bound to message ids the code owns. Job-alert URLs the model invents are dropped.
- **Provider outages do not poison data.** Anthropic HTTP/network errors abort the step (it is retried) and do not count as message failures or create review items. Only content failures consume `MAX_MESSAGE_ATTEMPTS`.
- **Numbers are never LLM generated.** The digest is rejected in favour of a deterministic template if it cites a number the database did not produce.

Dashboard cards are SQL aggregates (`src/lib/queries/stats.ts`). "New since last sync" counts records tagged with the most recent completed run.

---

## Security notes

- Every page and every API route checks the session against `ALLOWED_EMAIL` server-side. `src/proxy.ts` is an extra edge redirect, not the only barrier. State-changing API calls also reject cross-site requests.
- Gmail scopes: read-only. No send, modify or compose scope is ever requested, and any broader grant is refused.
- Secrets stay server-side. `.env` is git-ignored. Logs go through a redactor that removes tokens, API keys and connection strings, and email contents are never logged.
- CSV export neutralizes spreadsheet formula injection.

---

## Costs and limitations

I could not price these reliably offline, so check the current pricing pages: Anthropic, Vercel and Supabase.

- **Anthropic**: cost scales with the number of *relevant* emails. The prefilter and Gmail query drop most mail before any model call. A relevant email costs roughly one classification call plus one extraction call on the fast model, plus a small share of a supervisor turn on the supervisor model. Large first backfills are the main cost. Use a short date range first, and set `ANTHROPIC_MODEL_SUPERVISOR` to a cheaper model if you want to trade accuracy for cost.
- **Vercel**: Workflow SDK, function execution time and Fluid compute are usage-priced and subject to plan limits. Hobby plans are limited to non-commercial use and have lower limits.
- **Supabase**: free projects can pause after a period of inactivity and have connection and storage limits. Use the pooled URL from Vercel.
- **Gmail API**: 250 quota units per user per second. `messages.get` costs 5 units, so the default concurrency of 5 stays well below it.
- **Accuracy**: classification quality depends on the model. Anything under 0.7 confidence, or not matchable to exactly one application, lands in Needs Review rather than being guessed. Company matching uses normalized names plus a prefix rule (so "Meta" and "Metabase" can collide). The role title and job id disambiguate in practice.
- Messages without a plain-text or HTML part (images only) are classified from their snippet.
- A single user is assumed. Multi-user support would need per-user allowlisting and per-user OAuth state.
- Interview dates are stored in the event summary text, not as structured calendar data.

---

## Tests

```bash
npm test
```

- Unit: normalization and dedupe keys, status transitions, application matching (including the same-company rejection scenario), prefilter shortcuts and Zod schemas, encryption, log redaction, OAuth scope rules, prompt-injection delimiting, CSV escaping.
- Integration (PGlite with the real migrations): API authorization (401, 403, cross-site, ownership), `POST /api/sync` behaviour and locking, full sync with the real LangChain supervisor and subagents driven by scripted chat models, repeated refreshes, history based incremental sync, expired history rescan, resumable backfill after a mid-run failure, recovery of pending messages, provider outage handling, durable lock and stale lock release, review resolution.
