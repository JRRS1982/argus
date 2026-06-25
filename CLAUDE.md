# Argus — PR Review Dashboard

A local Next.js 16 + TypeScript dashboard that caches Bitbucket PR data in a local SQLite database and presents four analytical tabs over the last 6 months of merged-to-main activity.

## Stack

- **Next.js 16** (App Router) + **TypeScript** — pure functions throughout
- **Tailwind CSS v4** for styling
- **better-sqlite3** for local SQLite cache at `data/argus.sqlite`
- **Bitbucket REST API v2** — Basic auth using `BITBUCKET_EMAIL` + `BITBUCKET_API_TOKEN`

## The four tabs

- **Team** — team roster with per-user and per-repo include/exclude toggles; Discover workspace and Refresh data controls
- **Review-time leaderboard** — median in-review duration per engineer, expandable to per-PR rows; flagged PRs (`*`) used creation time as fallback
- **PRs created** — matrix of PRs created per engineer per month
- **Approvals** — matrix of approvals given per engineer per month (self-approvals excluded)

## Key metric definitions

- **In-review time**: ready-for-review → merged. Falls back to PR creation time when no draft→ready transition is found (flagged `*`).
- **Scope**: merged-to-main PRs, last 6 months only.

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

Then on the Team tab: **Discover workspace** → toggle users/repos → **Refresh data**.

## Data flow

1. **Discover** (`POST /api/discover`) — queries Bitbucket for all workspace users and repos; stores them in SQLite as candidates.
2. **Roster** (`GET /api/roster`) — returns current include/exclude state for users and repos.
3. **Sync** (`POST /api/sync`) — fetches PR activity for all included users/repos over the last 6 months; upserts into SQLite; incremental (only new activity fetched on subsequent runs).
4. **Insights** (`GET /api/insights`) — reads SQLite and returns leaderboard rows, PRs-created matrix, and approval matrix to the frontend.

## SQLite schema

The cache lives at `data/argus.sqlite` (created automatically; git-ignored). Delete it to start from scratch.

Key tables: `pull_requests` (keyed by `(repo_slug, id)`), `activities` (approvals, state transitions), `users`, `repos`.

## Adding / removing team members

Use the **Team** tab checkboxes — no code changes needed. The roster auto-discovers from the Bitbucket workspace on Discover. Re-run Discover if new engineers join the workspace.

## Development notes

- All data-access functions are pure and live in `src/lib/`.
- API routes live in `src/app/api/`.
- The frontend is a single-page React app under `src/app/`.
- No Jira integration; no per-user account-ID config; no external database.
