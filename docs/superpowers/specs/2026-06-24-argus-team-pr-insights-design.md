# Argus — Team PR Insights — Design

**Date:** 2026-06-24
**Status:** Approved (design); pending implementation plan
**Repo:** `pr-review-dashboard` (built on a feature branch off `main`)

## Summary

Argus is a local, single-user Next.js dashboard that turns Bitbucket pull-request
history into team insights: who reviews whose code, how long PRs sit in review, and
how PR creation and approvals are distributed across the team. It extends the
existing `pr-review-dashboard` repo, reusing its Bitbucket data layer and adding a
local SQLite cache plus a pure-function analytics core.

## Goals

- Visibility into team code-review activity over the last 6 months.
- A review-time leaderboard ranking PR authors by how long their PRs spent in review.
- A users × projects matrix of PRs created.
- A users × users matrix of approvals (who approves whose PRs).
- One-click incremental refresh from Bitbucket.

## Non-goals (YAGNI)

- Trend-over-time charts.
- Per-PR comment counts or review-thread analysis.
- Authentication / multi-user hosting — it is a local personal tool.
- Live-only fetching (replaced by a persisted cache).

## Architecture

Next.js 15 (App Router) + TypeScript + Tailwind. Two new pillars over the existing
live-fetch app:

- **SQLite cache** via `better-sqlite3` (synchronous, zero-server, ideal for a
  local single-user tool).
- **Layered, pure-function core** so analytics are testable in isolation from both
  Bitbucket and React:
  - `lib/bitbucket/` — extends the existing client: workspace members, repo list,
    PRs + per-PR activity/approvals.
  - `lib/db/` — SQLite schema + typed query functions.
  - `lib/sync/` — orchestrates incremental refresh (Bitbucket → DB).
  - `lib/analytics/` — pure functions producing view models (leaderboard,
    matrices). Input = DB rows, output = view models. No I/O.
  - `app/api/` — `discover`, `sync`, plus read endpoints for views.

### Boundaries

- `analytics/` never touches the network or the DB driver — it receives plain rows
  and returns plain view models, so it is fully unit-testable.
- `sync/` is the only layer that writes to the DB and the only consumer of the
  Bitbucket client during refresh.
- `bitbucket/` returns typed domain objects, hiding REST/pagination details.

## Data model (SQLite)

- `users(account_id PK, display_name, included)`
- `repos(slug PK, name, project_key, main_branch, included)`
- `pull_requests(id, repo_slug, author_account_id, title, state, created_on,
  ready_for_review_on, merged_on, destination_branch, url)`
- `approvals(pr_id, approver_account_id, approved_on)` — many rows per PR
- `sync_state(repo_slug, last_synced_on)` — drives incremental refresh

## Views (tabbed dashboard)

1. **Team** — roster of discovered users with include/exclude toggles, summary
   counts (PRs authored, approvals given), and the **Refresh data** button that
   triggers an incremental sync. This is the "colleague table + button" requirement.
2. **Review-time leaderboard** — rows = authors, ranked by average in-review time
   (**ready-for-review → merged**, merged-to-main/master PRs only, last 6 months).
   Each row expands to that author's PRs with each PR's individual open duration.
   Default sort fastest-first, toggleable.
3. **PRs-created matrix** — users (rows) × projects (cols), count of PRs *created*,
   with row/column totals.
4. **Approval matrix** — users (rows) × users (cols): how many times the row
   author's PRs were approved by the column user. Self-approvals excluded (diagonal
   blank).

## Data flow

1. **First run:** Team tab → *Discover* → fetch workspace members + repos → store →
   user toggles who/what to include. Scope is the Bitbucket workspace (and optionally
   a project key).
2. **Refresh:** button → `POST /api/sync` → for each included repo, fetch PRs
   updated since `last_synced_on` plus their activity/approvals → upsert into SQLite
   → return a summary.
3. **Views:** read straight from SQLite via the pure `analytics/` functions →
   render instantly, no live API wait.

## Metric definitions

- **In-review time** = `merged_on − ready_for_review_on`. `ready_for_review_on` is
  derived from the PR activity log (when the draft state was lifted); if no draft
  transition is found, fall back to `created_on`.
- **Merged to master** = merged into the repo's main branch (`main_branch`, detected
  per repo — may be `main` or `master`).
- **PRs created** = PRs authored by a user in a repo, regardless of state.
- **Approval count** = number of distinct PRs authored by the row user that the
  column user approved; self-approvals excluded.

## Edge cases & risks

- **Draft→ready timestamp (main risk).** Bitbucket Cloud's draft history is not
  always cleanly exposed. Derive "ready-for-review" from the PR activity log; **fall
  back to `created_on`** when absent, and surface a small UI note so the number is
  honest. Validate against real data during implementation.
- **main vs master** — detected per repo from its main branch; the leaderboard
  counts only PRs merged into that branch.
- **Non-roster / departed users** — matrices show only *included* users on the axes,
  keeping them square and readable.
- **Open / unmerged PRs** — excluded from the review-time leaderboard (no merge
  time).
- **Rate limits** — mitigated by incremental sync + paginated fetch with backoff.

## Testing

- Unit-test the pure `analytics/` functions and date-duration logic against fixture
  PR data — the area most likely to harbor subtle bugs (draft exclusion, matrix
  aggregation, totals).
- Test the Bitbucket client against recorded response fixtures (PR list, activity,
  approvals) to lock parsing of draft transitions and approvers.

## Open follow-ups (post-MVP)

- Trends over time once 6+ months of cached data accumulate.
- An "others" bucket for non-roster contributors on the matrices.
