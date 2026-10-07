# Argus — PR Review Dashboard

A local Next.js 16 + TypeScript dashboard that caches pull-request data from **GitHub (live)** and **Bitbucket (frozen archive)** in a local SQLite database and presents four analytical tabs. Canonical `people` and `services` each own one or more per-provider identities, so a repo that moved between providers appears once with one continuous history, and every tab computes from canonical ids.

## Stack

- **Next.js 16** (App Router) + **TypeScript** — pure functions throughout
- **Tailwind CSS v4** for styling
- **better-sqlite3** for local SQLite cache at `data/argus.sqlite`
- **GitHub** (`src/lib/github/`) — the only provider that is fetched; authenticated with `GITHUB_TOKEN`, discovering the `GITHUB_ORG` organisation
- **Bitbucket REST API v2** (`src/lib/bitbucket/`) — Basic auth using `BITBUCKET_EMAIL` + `BITBUCKET_API_TOKEN`. **A frozen, read-only archive: never fetched again.** Its 7,603 cached PRs and 8,848 approvals still count in every window and every tab; only fetching stops.

## The four tabs

- **Team** — team roster with per-user and per-repo include/exclude toggles; Discover workspace, Refresh data and Backfill all history controls, plus a warning panel naming any repository the last refresh could not read
- **Review-time leaderboard** — median and average in-review duration per engineer, with Merged and Open PR counts, expandable to per-PR rows (sorted slowest-first); the `*` flag is per row, applied when that row's start time is a creation-time fallback
- **PRs created** — matrix of PRs created, engineers (rows) × projects/repos (columns), with the row total (PR count) placed immediately beside the engineer name rather than trailing the grid, plus a Services column (distinct repos touched); repos with no in-scope PRs in the active window are omitted from the columns
- **Approvals** — matrix of approvals, PR authors (rows) × approvers (columns): how many of each author's PRs each colleague approved (self-approvals excluded, diagonal greyed out, each row's top approver highlighted), plus a "Merged, no approval" column

Engineer names are sorted alphabetically (case-insensitive) everywhere they appear — both matrices and the leaderboard, which is a record of contribution rather than a speed ranking and carries no rank column. Both matrices label their axes; each tab carries a short description above its table. A highlights strip above the tabs bookends recognition with context: it leads with a "PRs considered" count card (the PRs-created row totals — the number that visibly moves after a refresh or backfill, always shown even at 0), then calls out a few engineers by name — broadest reach, most reviews given, quickest to land — and ends with a "Data refreshed" card showing one line per provider: live providers first, Bitbucket's line reading `archived <date>`, and a provider with no data omitted entirely (demo mode shows a single "Demo" line). "Never" with a prompt to run Refresh data on the Team tab is only the empty state when no provider has any data at all. All of it is recomputed from whichever window and data source (real or demo) is active. A **Last 30 days / Last 6 months / All time** toggle above the tabs switches the read-time window for every tab at once.

## Key metric definitions

- **In-review time**: decided **per row**, not per table. Each PR carries a precision for each end of the interval. **GitHub** exposes `merged_at` directly (end is `exact`) and a `ready_for_review` timeline event (start is `exact`, falling back to creation for PRs never drafted). **Bitbucket**'s PR list exposes no merge timestamp, so its end is `updated_on` (`derived` — that is the merge for almost all PRs, but drifts later if anyone comments after merging) and its start falls back to creation time (`fallback`). Any row with a fallback start is flagged `*`. The leaderboard's `*` flag and its "created → last touched" caveat are derived from the rows actually on screen, so the copy makes no claim about an empty window or about exact rows that are not there. **Today every row is flagged**: all 7,603 migrated PRs are `fallback`/`derived`, because the existing cache was only ever built with fast syncs. The asterisk becomes the exception only after a deep GitHub backfill.
- **Median vs average review time**: both are shown. **Median** is the more trustworthy of the two, because a few long-lived PRs skew the mean.
- **Services**: the number of distinct included repos an engineer opened at least one PR in — breadth, not volume.
- **Merged, no approval**: merged PRs with no approval from anyone other than the author. They have no approver to attribute, so they sit outside the grid rather than being invisible.
- **Scope**: one shared definition in `src/lib/analytics/scope.ts` — `MERGED` or `OPEN` state, targeting the repo's main branch, in an included service, by an included person. `DECLINED`/`SUPERSEDED` are excluded as abandoned work (roughly half of what Bitbucket returns). Every tab uses it, so the tabs cannot disagree about which PRs exist. State is filtered on read, not at fetch: sync must keep collecting every state, or a PR cached while open would never learn it was later declined.
- **Tab reconciliation**: on **All time**, a leaderboard row's `Merged + Open` equals that engineer's row total on PRs created. On a windowed view they differ by design — the leaderboard windows on when a PR *landed*, PRs created windows on when it was *opened*. Engineers with no merged PRs in the window are absent from the leaderboard entirely.
- **Window**: rolling 6 months by default (recomputed per request), rolling 30 days, or all time. All are read-time filters — the SQLite cache is never pruned.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_TOKEN` | Yes | — | GitHub token able to read the org's repos, PRs and members |
| `GITHUB_ORG` | No | `mvfglobal` | GitHub organisation to discover |
| `BITBUCKET_EMAIL` | No | — | Only needed to read Bitbucket; the archive is never fetched, so it is optional |
| `BITBUCKET_API_TOKEN` | No | — | As above |
| `BITBUCKET_WORKSPACE` | No | `mvfglobal` | Bitbucket workspace slug |
| `BITBUCKET_PROJECT_KEY` | No | (all projects) | Bitbucket project key |
| `ARGUS_DB_PATH` | No | `data/argus.sqlite` | Override SQLite cache path |
| _(none)_ | — | — | With no provider configured at all (no `GITHUB_TOKEN` and no Bitbucket credentials), the app runs in demo mode: fabricated data, no provider calls, no SQLite access |

Config is read from `src/config/index.ts`.

## Running the app

```bash
cp .env.local.example .env.local   # fill in GITHUB_TOKEN (and GITHUB_ORG if not mvfglobal)
npm install
npm run dev                         # http://localhost:3000
```

Then on the Team tab: **Discover workspace** → tick the people/services you want → **Refresh data**.

Discovery adds everything it finds as **excluded**, so a first run starts with nothing selected — the workspace can hold hundreds of repos, and only ticked ones are fetched. Re-running Discover never changes a choice you have already made.

## Demo mode

A **Demo data** toggle sits beside the window toggle. It swaps the data source for a
seeded, in-memory fixture of 5 engineers and 5 repos — the same record types the
database returns, fed through the same analytics functions, so the demo cannot drift
from real behaviour.

- **Availability**: shown in development, and on any instance with no provider
  configured. Never shown on a credentialed production instance.
- **Default**: on when there are no credentials, off otherwise.
- **Writes**: Discover, Refresh and roster include/exclude edits are all disabled
  while demo mode is on — at the UI and at the API.
- **Storage**: none. Demo data is generated per request and never written to SQLite,
  which is what makes a read-only host like Vercel work.

Dates in the fixture are generated relative to now, so both window settings always
have data.

## Data flow

1. **Discover** (`POST /api/discover`) — queries GitHub only and stores people and repos as candidates. **It no longer runs Bitbucket discovery at all**: migration 001 already holds every Bitbucket repo and person, so re-discovering adds nothing, and it used to run first and unconditionally, so a missing or reduced-permission Bitbucket token failed the whole route before GitHub ran. It needs only `GITHUB_TOKEN` (400 without it).
   - **Auto-linking is exact after normalisation** (lower-case, strip `-`/`_`/`.`/whitespace; `src/lib/analytics/linking.ts`), deliberately not fuzzy and null on ambiguity: a wrong merge silently fuses two histories, while a missed one is visible and fixable on the Team tab. Measured: 44 of 51 included repos link automatically; `benchmarkmeapp` → `benchmarkme` is a rename needing one manual link; `chameleon-qa` and `chameleon-acceptance-tests` are different repos and must never be merged.
   - **GitHub members with private org membership are never discovered** (the token sees ~52 members against 121 canonical people from Bitbucket history). They are created later from PR authorship under their login and need a manual merge; the Team tab flags them as possible duplicates.
   - Discover adds new arrivals **excluded**, and merges never un-tick a choice already made.
2. **Roster** (`GET /api/roster`) — returns current include/exclude state for people and services.
3. **Sync** (`POST /api/sync`) — fetches PR activity for every identity whose state is `active` (all of GitHub) and upserts into SQLite; incremental (only activity since the last sync is fetched, and an identity's very first sync reaches back 6 months). Body `{ backfill: true }` ignores the cursor and fetches each repo's entire PR history — required once for **All time** to be complete. The UI exposes this as **Backfill all history** on the Team tab.
   - **Bitbucket is archived, not synced.** Every Bitbucket identity has `state = 'archived'`, stamped by migration 001 as an asserted fact rather than inferred from any error. `syncAll` skips archived identities before making a request, so a lapsed Bitbucket credential or a deleted Bitbucket repo can never stall a refresh. If nothing is fetchable (no active identity, or no `GITHUB_TOKEN`) the route answers 400 saying so.
   - **GitHub always syncs at full detail**, not just on backfill. GitHub's PR list carries no review data, so summary detail would return no approvals at all and the Approvals tab would permanently under-count. A daily incremental touches few PRs, so the cost (two requests per PR: timeline + reviews) is trivial. The `mode` body field only affects providers whose summary is enough.
   - **The first deep backfill needs two runs.** For ~2,883 human-authored PRs plus ~406 list pages that is ~6,172 requests against GitHub's 5,000/hour limit. This is expected and self-healing, not a fault: the limit surfaces as a 429-class error, the run aborts, every repo that completed keeps its advanced cursor, the API returns 200 with `stoppedEarly: { provider, status, reason }`, and a second run finishes the rest.
   - **Known limitation:** a repo's PRs are persisted only after its whole fetch completes, so a single repo whose full fetch exceeds one hourly budget would never complete. Not reachable with this data (3,679 PRs across 369 repos); a real fix needs a resume watermark.
   - **One repo's failure never costs the rest of the run.** Each identity has its own cursor, so `syncAll` catches per repo and carries on: the failing repo keeps its old cursor and retries the same range next time, every other repo still advances. Failures come back as `skipped: [{ provider, repoKey, reason, status, missing }]` alongside a 200; only a run where *every* repo failed is a 502.
   - **Except when the failure isn't the repo's fault.** A `401` or `429` describes the credential or the account, so `syncAll` stops on those and reports the remaining repos as *not attempted*, rather than spending one more rejected request per repo — continuing through a 429 would extend the block that caused it. `403` and `404` really are per-repo, and the run continues.
   - **`missing` means the repo is gone, and only that.** It is a `404` *on the repo's own PR list* — tagged at the point of the call by the adapter, not inferred from the status alone, so a `404` from one PR's timeline or a pagination cursor can never brand a healthy repo as deleted. It also survives only when **every** identity of the service (archived ones included) is missing, so a service holding archived Bitbucket history is never offered for removal.
   - The Team tab lists skipped repos in a warning panel and offers **Remove from roster** on the `missing` ones — but only once at least one repo has succeeded. A wrong org name 404s every URL alike, and offering to untick all of them would hand the user a way to wipe their roster over a single misconfiguration. Nothing is ever unticked automatically.
   - Provider failures surface as `ProviderApiError` (`status`, `statusText`, `url`) with a plain-English message per status; the request URL is kept off the message and written to the server log, since that is the only record of *which* URL was refused.
4. **Insights** (`GET /api/insights`) — reads SQLite and returns leaderboard rows, PRs-created matrix, and approval matrix to the frontend. The Team tab also shows data freshness per provider.

## SQLite schema

The cache lives at `data/argus.sqlite` (created automatically; git-ignored). Delete it to start from scratch — but note it now holds the **only copy of the Bitbucket history**, which can no longer be re-fetched.

Key tables: `pull_requests` (keyed by `(provider, repo_key, number)`), `approvals` (keyed by `(provider, repo_key, pr_number, approver_account_id)`), `people` / `person_identities` and `services` / `service_identities` (canonical entity, owning one or more per-provider identities; each service identity has a `state` of `active` or `archived`). The pre-migration `pull_requests`, `approvals`, `users` and `repos` tables are kept as `legacy_*` and never dropped.

**Migrations** (`src/lib/db/migrations/`) are forward-only and numbered, each run in a transaction and guarded by a row-count assertion on `pull_requests` and `approvals` that rolls back on any change — cached history is irreplaceable. A verified snapshot (`VACUUM INTO` beside the cache, integrity-checked) is taken before any migration runs, and the run is refused if it cannot be written. A database whose schema is newer than the code refuses to open rather than rebuilding it.

## Adding / removing team members

Use the **Team** tab checkboxes — no code changes needed. The roster auto-discovers from the GitHub org on Discover, with new arrivals excluded by default. Re-run Discover if new engineers join the org, then tick them. Merge a GitHub-only person or a renamed repo into its existing canonical entry from the same tab.

## Development notes

- All data-access functions are pure and live in `src/lib/`.
- API routes live in `src/app/api/`.
- The frontend is a single-page React app under `src/app/`.
- No Jira integration; no per-user account-ID config; no external database. Provider adapters live behind `src/lib/providers/` (contract, registry).

## Design specs — read before proposing architecture

`docs/superpowers/specs/` holds the decision records for this app, tracked in git. **Check it before
designing anything structural** — it records what was chosen, what was rejected, and why, which the
code cannot tell you. A provider-agnostic design sat there approved but unimplemented for two
months in 2026 because nothing pointed at it, and was nearly duplicated from scratch.

Every spec carries a `**Status:**` line, which must be kept honest:

| Status | Meaning |
|---|---|
| `approved for planning` | Agreed, not yet built. **Treat as binding** — build to it, or supersede it deliberately. |
| `implemented` | Shipped. Read it for rationale, not for plans. |
| `superseded` | Replaced. Must name its replacement in a banner at the top. |

Superseding is the correct way to disagree with an existing spec: write the new one, state what it
overturns and why, and mark the old one. Never leave two live specs contradicting each other.

Current specs:

- `2026-06-24-argus-team-pr-insights-design.md` — the four tabs and their metrics. *implemented*
- `2026-07-28-provider-agnostic-argus-design.md` — port/adapter restructure. *superseded*
- `2026-07-29-demo-mode-and-motivational-framing-design.md` — demo mode. *implemented*
- `2026-09-28-dual-provider-design.md` — Bitbucket + GitHub together, canonical identity, migration
  safety. *implemented*

`docs/superpowers/plans/` and `.superpowers/` are local scratch and deliberately untracked.
