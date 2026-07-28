# Argus — PR Review Dashboard

A local Next.js 16 + TypeScript dashboard that caches Bitbucket PR data in a local SQLite database and presents four analytical tabs over the last 6 months of merged-to-main activity.

## Stack

- **Next.js 16** (App Router) + **TypeScript** — pure functions throughout
- **Tailwind CSS v4** for styling
- **better-sqlite3** for local SQLite cache at `data/argus.sqlite`
- **Bitbucket REST API v2** — Basic auth using `BITBUCKET_EMAIL` + `BITBUCKET_API_TOKEN`

## The four tabs

- **Team** — team roster with per-user and per-repo include/exclude toggles; Discover workspace and Refresh data controls
- **Review-time leaderboard** — median and average in-review duration per engineer, ranked by median, with Merged and Open PR counts, expandable to per-PR rows; flagged PRs (`*`) used creation time as fallback
- **PRs created** — matrix of PRs created, engineers (rows) × projects/repos (columns), with row/column totals and a Services column (distinct repos touched)
- **Approvals** — matrix of approvals, PR authors (rows) × approvers (columns): how many of each author's PRs each colleague approved (self-approvals excluded, diagonal greyed out, each row's top approver highlighted), plus a "Merged, no approval" column

Engineer name columns are sorted alphabetically (case-insensitive) in both matrices; both matrices label their axes; each tab carries a short description above its table. A **Last 6 months / All time** toggle above the tabs switches the read-time window for every tab at once.

## Key metric definitions

- **In-review time**: in practice **created → last touched**. The end of the interval is `updated_on`, because Bitbucket's PR list exposes no merge timestamp — that is the merge for almost all PRs, but drifts later if anyone comments after merging. The start is the draft→ready transition where one was recorded, otherwise creation time (flagged `*`). Only a `deep` sync can derive real ready times; a `fast` sync makes every PR a fallback. The leaderboard states all of this in the UI.
- **Median vs average review time**: both are shown; the leaderboard ranks by **median** because a few long-lived PRs skew the mean.
- **Services**: the number of distinct included repos an engineer opened at least one PR in — breadth, not volume.
- **Merged, no approval**: merged PRs with no approval from anyone other than the author. They have no approver to attribute, so they sit outside the grid rather than being invisible.
- **Scope**: one shared definition in `src/lib/analytics/scope.ts` — `MERGED` or `OPEN` state, targeting the repo's main branch, in an included repo, by an included user. `DECLINED`/`SUPERSEDED` are excluded as abandoned work (roughly half of what Bitbucket returns). Every tab uses it, so the tabs cannot disagree about which PRs exist. State is filtered on read, not at fetch: sync must keep collecting every state, or a PR cached while open would never learn it was later declined.
- **Tab reconciliation**: on **All time**, a leaderboard row's `Merged + Open` equals that engineer's row total on PRs created. On a windowed view they differ by design — the leaderboard windows on when a PR *landed*, PRs created windows on when it was *opened*. Engineers with no merged PRs in the window are absent from the leaderboard entirely.
- **Window**: rolling 6 months by default (recomputed per request), or all time. Both are read-time filters — the SQLite cache is never pruned.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BITBUCKET_EMAIL` | Yes | — | Atlassian account email (Basic auth) |
| `BITBUCKET_API_TOKEN` | Yes | — | API token from id.atlassian.com |
| `BITBUCKET_WORKSPACE` | Yes | `mvfglobal` | Bitbucket workspace slug |
| `BITBUCKET_PROJECT_KEY` | No | (all projects) | Limit discovery to one project key |
| `ARGUS_DB_PATH` | No | `data/argus.sqlite` | Override SQLite cache path |

Config is read from `src/config/index.ts`.

## Running the app

```bash
cp .env.local.example .env.local   # fill in BITBUCKET_EMAIL, BITBUCKET_API_TOKEN, BITBUCKET_WORKSPACE
npm install
npm run dev                         # http://localhost:3000
```

Then on the Team tab: **Discover workspace** → tick the users/repos you want → **Refresh data**.

Discovery adds everything it finds as **excluded**, so a first run starts with nothing selected — the workspace can hold hundreds of repos, and only ticked ones are fetched. Re-running Discover never changes a choice you have already made.

## Data flow

1. **Discover** (`POST /api/discover`) — queries Bitbucket for all workspace users and repos; stores them in SQLite as candidates.
2. **Roster** (`GET /api/roster`) — returns current include/exclude state for users and repos.
3. **Sync** (`POST /api/sync`) — fetches PR activity for all included users/repos over the last 6 months; upserts into SQLite; incremental (only new activity fetched on subsequent runs).
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
