# Argus — PR Review Dashboard

A local Next.js dashboard that pulls Bitbucket pull-request data for a team and presents four analytical views: a team roster, a review-time leaderboard, a PRs-created matrix, and an approval matrix. All data is cached in a local SQLite database so subsequent refreshes are incremental.

## Stack

- **Next.js 16** (App Router) + **TypeScript**
- **Tailwind CSS v4** for styling
- **better-sqlite3** for local SQLite cache (`data/argus.sqlite`)
- **Bitbucket REST API v2** (Basic auth: email + API token)

## The four tabs

| Tab | What it shows |
|-----|---------------|
| **Team** | Team roster with include/exclude toggles for users and repos; Discover and Refresh data controls |
| **Review-time leaderboard** | Average and per-PR in-review duration per engineer, sorted fastest-first; expandable rows show individual PRs |
| **PRs created** | Matrix of PRs created — engineers (rows) × projects/repos (columns) — over the last 6 months, with row/column totals |
| **Approvals** | Matrix of approvals — PR authors (rows) × approvers (columns) — over the last 6 months: how many of each author's PRs each colleague approved; self-approvals are excluded |

## Metric definitions

- **In-review time**: time from the PR entering "ready for review" state to it being merged. When no draft→ready transition is recorded, the PR creation timestamp is used as the fallback (these PRs are flagged with `*` in the leaderboard).
- **Scope**: merged-to-main PRs only, over the last 6 months.
- **Self-approvals**: excluded from the Approvals matrix.

## Setup

### 1. Create `.env.local`

```bash
cp .env.local.example .env.local
```

Open `.env.local` and fill in the three required values:

| Variable | Description |
|----------|-------------|
| `BITBUCKET_EMAIL` | Your Atlassian account email |
| `BITBUCKET_API_TOKEN` | API token from https://id.atlassian.com/manage-profile/security/api-tokens |
| `BITBUCKET_WORKSPACE` | Bitbucket workspace slug (e.g. `mvfglobal`) |

Two optional overrides are also available (see `.env.local.example`):

- `BITBUCKET_PROJECT_KEY` — limit discovery to a single Bitbucket project
- `ARGUS_DB_PATH` — override the SQLite cache location (default: `data/argus.sqlite`)

### 2. Install dependencies

```bash
npm install
```

### 3. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Discover your workspace

1. Go to the **Team** tab.
2. Click **Discover workspace** — Argus queries Bitbucket for all users and repos in your workspace.
3. Use the checkboxes to include or exclude specific users and repos.
4. Click **Refresh data** — Argus fetches PR activity for all included users/repos and populates the SQLite cache.

After the first full refresh, subsequent refreshes are incremental (only new activity is fetched).

## Data persistence

All PR data is stored in `data/argus.sqlite` at the project root. The file is created automatically on first refresh and is excluded from version control (`.gitignore`). Delete it to start from scratch.

## Environment variables reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BITBUCKET_EMAIL` | Yes | — | Atlassian account email for Basic auth |
| `BITBUCKET_API_TOKEN` | Yes | — | Atlassian API token |
| `BITBUCKET_WORKSPACE` | Yes | `mvfglobal` | Bitbucket workspace slug |
| `BITBUCKET_PROJECT_KEY` | No | (all projects) | Scope discovery to one project key |
| `ARGUS_DB_PATH` | No | `data/argus.sqlite` | Override SQLite cache path |
