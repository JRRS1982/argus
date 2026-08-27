# Argus — PR Review Dashboard

A local Next.js 16 + TypeScript dashboard that caches Bitbucket PR data in a local SQLite database and presents four analytical tabs over the last 6 months of merged-to-main activity.

## Stack

- **Next.js 16** (App Router) + **TypeScript** — pure functions throughout
- **Tailwind CSS v4** for styling
- **better-sqlite3** for local SQLite cache at `data/argus.sqlite`
- **Bitbucket REST API v2** — Basic auth using `BITBUCKET_EMAIL` + `BITBUCKET_API_TOKEN`

## The four tabs

- **Team** — team roster with per-user and per-repo include/exclude toggles; Discover workspace, Refresh data and Backfill all history controls
- **Review-time leaderboard** — median and average in-review duration per engineer, with Merged and Open PR counts, expandable to per-PR rows (sorted slowest-first); flagged PRs (`*`) used creation time as fallback
- **PRs created** — matrix of PRs created, engineers (rows) × projects/repos (columns), with the row total (PR count) placed immediately beside the engineer name rather than trailing the grid, plus a Services column (distinct repos touched); repos with no in-scope PRs in the active window are omitted from the columns
- **Approvals** — matrix of approvals, PR authors (rows) × approvers (columns): how many of each author's PRs each colleague approved (self-approvals excluded, diagonal greyed out, each row's top approver highlighted), plus a "Merged, no approval" column

Engineer names are sorted alphabetically (case-insensitive) everywhere they appear — both matrices and the leaderboard, which is a record of contribution rather than a speed ranking and carries no rank column. Both matrices label their axes; each tab carries a short description above its table. A highlights strip above the tabs bookends recognition with context: it leads with a "PRs considered" count card (the PRs-created row totals — the number that visibly moves after a refresh or backfill, always shown even at 0), then calls out a few engineers by name — broadest reach, most reviews given, quickest to land — and ends with a "Data refreshed" card showing the newest sync stamp among included repos ("Never" until a first sync; demo mode shows its per-request generation instant). All of it is recomputed from whichever window and data source (real or demo) is active. A **Last 30 days / Last 6 months / All time** toggle above the tabs switches the read-time window for every tab at once.

## Key metric definitions

- **In-review time**: in practice **created → last touched**. The end of the interval is `updated_on`, because Bitbucket's PR list exposes no merge timestamp — that is the merge for almost all PRs, but drifts later if anyone comments after merging. The start is the draft→ready transition where one was recorded, otherwise creation time (flagged `*`). Only a `deep` sync can derive real ready times; a `fast` sync makes every PR a fallback. The leaderboard states all of this in the UI.
- **Median vs average review time**: both are shown. **Median** is the more trustworthy of the two, because a few long-lived PRs skew the mean.
- **Services**: the number of distinct included repos an engineer opened at least one PR in — breadth, not volume.
- **Merged, no approval**: merged PRs with no approval from anyone other than the author. They have no approver to attribute, so they sit outside the grid rather than being invisible.
- **Scope**: one shared definition in `src/lib/analytics/scope.ts` — `MERGED` or `OPEN` state, targeting the repo's main branch, in an included repo, by an included user. `DECLINED`/`SUPERSEDED` are excluded as abandoned work (roughly half of what Bitbucket returns). Every tab uses it, so the tabs cannot disagree about which PRs exist. State is filtered on read, not at fetch: sync must keep collecting every state, or a PR cached while open would never learn it was later declined.
- **Tab reconciliation**: on **All time**, a leaderboard row's `Merged + Open` equals that engineer's row total on PRs created. On a windowed view they differ by design — the leaderboard windows on when a PR *landed*, PRs created windows on when it was *opened*. Engineers with no merged PRs in the window are absent from the leaderboard entirely.
- **Window**: rolling 6 months by default (recomputed per request), rolling 30 days, or all time. All are read-time filters — the SQLite cache is never pruned.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BITBUCKET_EMAIL` | Yes | — | Atlassian account email (Basic auth) |
| `BITBUCKET_API_TOKEN` | Yes | — | API token from id.atlassian.com |
| `BITBUCKET_WORKSPACE` | Yes | `mvfglobal` | Bitbucket workspace slug |
| `BITBUCKET_PROJECT_KEY` | No | (all projects) | Limit discovery to one project key |
| `ARGUS_DB_PATH` | No | `data/argus.sqlite` | Override SQLite cache path |
| _(none)_ | — | — | With no `BITBUCKET_EMAIL`/`BITBUCKET_API_TOKEN`, the app runs in demo mode: fabricated data, no Bitbucket calls, no SQLite access |

Config is read from `src/config/index.ts`.

## Running the app

```bash
cp .env.local.example .env.local   # fill in BITBUCKET_EMAIL, BITBUCKET_API_TOKEN, BITBUCKET_WORKSPACE
npm install
npm run dev                         # http://localhost:3000
```

Then on the Team tab: **Discover workspace** → tick the users/repos you want → **Refresh data**.

Discovery adds everything it finds as **excluded**, so a first run starts with nothing selected — the workspace can hold hundreds of repos, and only ticked ones are fetched. Re-running Discover never changes a choice you have already made.

## Demo mode

A **Demo data** toggle sits beside the window toggle. It swaps the data source for a
seeded, in-memory fixture of 5 engineers and 5 repos — the same record types the
database returns, fed through the same analytics functions, so the demo cannot drift
from real behaviour.

- **Availability**: shown in development, and on any instance with no Bitbucket
  credentials. Never shown on a credentialed production instance.
- **Default**: on when there are no credentials, off otherwise.
- **Writes**: Discover, Refresh and roster include/exclude edits are all disabled
  while demo mode is on — at the UI and at the API.
- **Storage**: none. Demo data is generated per request and never written to SQLite,
  which is what makes a read-only host like Vercel work.

Dates in the fixture are generated relative to now, so both window settings always
have data.

## Data flow

1. **Discover** (`POST /api/discover`) — queries Bitbucket for all workspace users and repos; stores them in SQLite as candidates.
2. **Roster** (`GET /api/roster`) — returns current include/exclude state for users and repos.
3. **Sync** (`POST /api/sync`) — fetches PR activity for all included repos; upserts into SQLite; incremental (only activity since the last sync is fetched, and a repo's very first sync reaches back 6 months). Body `{ backfill: true }` ignores the cursor and fetches each repo's entire PR history — required once for **All time** to be complete. The UI exposes this as **Backfill all history** on the Team tab.
   - **One repo's failure never costs the rest of the run.** Each repo has its own cursor, so `syncAll` catches per repo and carries on: the failing repo keeps its old cursor and retries the same range next time, every other repo still advances. Failures come back as `skipped: [{ repoSlug, reason, status, missing }]` alongside a 200; only a run where *every* repo failed is a 502. The Team tab lists skipped repos in a warning panel, and offers **Remove from roster** for the ones Bitbucket reports as `missing` (HTTP 404 — deleted, or invisible to the token). A repo is never unticked automatically, so a Bitbucket outage cannot silently shrink the roster.
   - Discover only ever *adds*, so a repo that is later deleted stays ticked and 404s on every sync until it is unticked. That is what the panel is for.
   - Bitbucket failures surface as `BitbucketApiError` (`status`, `statusText`, `url`), whose message is plain English per status — the request URL is kept off the message because a PR query string is ~400 characters of state and field selectors.
4. **Insights** (`GET /api/insights`) — reads SQLite and returns leaderboard rows, PRs-created matrix, and approval matrix to the frontend.

## SQLite schema

The cache lives at `data/argus.sqlite` (created automatically; git-ignored). Delete it to start from scratch.

Key tables: `pull_requests` (keyed by `(repo_slug, id)`), `activities` (approvals, state transitions), `users`, `repos`.

## Adding / removing team members

Use the **Team** tab checkboxes — no code changes needed. The roster auto-discovers from the Bitbucket workspace on Discover, with new arrivals excluded by default. Re-run Discover if new engineers join the workspace, then tick them.

## Development notes

- All data-access functions are pure and live in `src/lib/`.
- API routes live in `src/app/api/`.
- The frontend is a single-page React app under `src/app/`.
- No Jira integration; no per-user account-ID config; no external database.
