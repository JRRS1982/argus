# Argus — PR Review Dashboard

**[Live demo → argus-blush-chi.vercel.app](https://argus-blush-chi.vercel.app/)**

A local Next.js dashboard that pulls Bitbucket pull-request data for a team and presents four analytical views: a team roster, a review-time leaderboard, a PRs-created matrix, and an approval matrix. All data is cached in a local SQLite database so subsequent refreshes are incremental.

The live link above runs with no Bitbucket credentials, so it serves [demo mode](#demo-mode): a seeded fixture of five invented engineers across five invented repositories. Every figure on it is fabricated — no real people, repositories or review times. The analytics computing those figures are the same ones that run against real data.

## Screenshots

All taken from the live demo.

### Review-time leaderboard

How long each engineer's work sits in review before it lands. Listed alphabetically rather than ranked by speed — the median and average are there to read, not to compete over. Rows expand to the individual PRs behind them.

![Review-time leaderboard: five engineers listed alphabetically with median and average review times, merged and open PR counts](docs/screenshots/leaderboard.png)

### PRs created

What each engineer shipped and where. The headline PR count sits immediately beside the name, followed by Services — the number of distinct repositories they shipped into, a measure of breadth rather than volume. The grid behind those two columns breaks the same PRs down per repository.

![PRs created matrix: engineers as rows, repositories as columns, with PRs by engineer and Services columns leading the grid](docs/screenshots/prs-created.png)

### Approvals

Who helps whom get work over the line. Read a row as: of this author's PRs, how many each colleague reviewed. Self-approvals are excluded so the diagonal is greyed out, and each row's most frequent reviewer is highlighted. The final column counts PRs merged with nobody else's approval — work that happened but has no reviewer to credit.

![Approvals matrix: PR authors as rows, approvers as columns, with the diagonal greyed out and each row's top approver highlighted](docs/screenshots/approvals.png)

## Stack

- **Next.js 16** (App Router) + **TypeScript**
- **Tailwind CSS v4** for styling
- **better-sqlite3** for local SQLite cache (`data/argus.sqlite`)
- **Bitbucket REST API v2** (Basic auth: email + API token)

## The four tabs

| Tab | What it shows |
|-----|---------------|
| **Team** | Team roster with include/exclude toggles for users and repos; Discover and Refresh data controls |
| **Review-time leaderboard** | Median and average in-review duration per engineer, listed alphabetically; expandable rows show individual PRs, slowest first |
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

## Demo mode

No Bitbucket credentials? Argus still runs. With no `BITBUCKET_EMAIL`/`BITBUCKET_API_TOKEN` set, a **Demo data** toggle appears beside the date-range toggle, and it defaults to on — this is what lets the dashboard deploy publicly with nothing to configure. [argus-blush-chi.vercel.app](https://argus-blush-chi.vercel.app/) is exactly that: a Vercel deployment with no environment variables set.

- Demo mode swaps the data source for a seeded, in-memory fixture of 5 engineers and 5 repos — the same record types the database returns, run through the same analytics functions, so the demo can't drift from real behaviour.
- It never touches SQLite: nothing is read or written to `data/argus.sqlite`, which is what makes it safe on a read-only filesystem.
- Discover, Refresh data, and the roster checkboxes are all disabled while it's on, since there is no real workspace to modify.
- Dates in the fixture are generated relative to the current time, so both **Last 6 months** and **All time** always show data.
- On a deployment with real credentials, the toggle never appears — demo mode is only ever available when there is nothing real to protect.

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
