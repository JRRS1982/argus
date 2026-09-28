# Demo mode and motivational framing — design

**Date:** 2026-07-29
**Status:** implemented

## Problem

Argus can only be shown to someone who has Bitbucket credentials and a populated
local SQLite cache. That blocks two things:

1. **Showing the work publicly.** The dashboard should be demonstrable on a
   personal portfolio, to a non-technical viewer, without exposing MVF data.
2. **A usable first run.** With no environment variables configured, every tab is
   empty and the app looks broken rather than unconfigured.

Separately, the dashboard currently reads as a measurement tool. It should read as
recognition of engineering contribution.

## Goals

- A demo-data toggle that populates every tab from fabricated data.
- A public Vercel deployment that a non-technical visitor can explore immediately.
- No possibility of company data reaching the public deployment.
- Reframe the four tabs so they motivate rather than rank.
- On PRs created, put the headline PR count next to the engineer's name.

## Non-goals

- Persisting demo data. It is generated per request, never written to disk.
- Making sync or discovery work on Vercel.
- Changing any analytics maths.

## Design

### 1. Availability and default state

Two derived booleans, computed server-side in `src/config/index.ts`:

```
demoAvailable  = isDev || !hasBitbucketCredentials
demoDefaultOn  = !hasBitbucketCredentials
```

where `hasBitbucketCredentials` is `BITBUCKET_EMAIL && BITBUCKET_API_TOKEN`.

| Context | Toggle visible | Default |
|---|---|---|
| Local, `.env.local` filled in | Yes (dev) | Off — real data |
| Local, no env vars | Yes | On — populated fields |
| Vercel (no credentials) | Yes | On — visitor sees a full dashboard |
| Credentialed production deploy | No | — |

This honours "only on dev" in substance: the toggle never appears on a production
instance that has real data behind it. Vercel qualifies because it *cannot* have
real data (see §3).

### 2. Delivery to the client

`src/app/page.tsx` becomes a server component that reads the flags and renders a
new client component holding the existing UI:

```tsx
export default function Page() {
  return <Dashboard demoAvailable={isDemoAvailable()} demoDefaultOn={isDemoDefaultOn()} />;
}
```

All current `page.tsx` contents (hooks, `RangeToggle`, tab switching) move
verbatim to `src/components/Dashboard.tsx` with `"use client"`.

**Why server-rendered rather than folded into `/api/roster`:** the flags are
correct on first paint. Carrying them in a fetched payload means a public visitor
sees an empty dashboard for the duration of the round-trip before it flips
populated — the exact "looks broken" impression that default-on exists to
prevent. It also keeps config out of the client bundle and leaves `/api/roster`
semantically about users and repos.

### 3. Demo data generation

New module `src/lib/demo/fixture.ts` exporting:

```ts
buildDemoDataset(nowIso: string): {
  users: UserRecord[];        // 5, all included
  repos: RepoRecord[];        // 5, all included
  prs: PullRequestRecord[];
  approvals: ApprovalRecord[];
}
```

Two properties are load-bearing:

- **Dates are generated relative to `nowIso`.** A fixture with hardcoded dates
  would silently age out of the rolling 6-month window and render blank. Both
  window settings must always have data, with enough spread that the 6-month and
  All-time views visibly differ.
- **It returns the same record types the database returns**, and the demo path
  feeds them through the existing `computeLeaderboard`,
  `computePrsCreatedMatrix` and `computeApprovalMatrix`. Demo mode swaps the
  *source*, never the *maths* — so the demo cannot drift from real behaviour and
  it exercises the real analytics code.

Randomness uses a seeded `mulberry32` PRNG, not `Math.random`, so output is
stable across renders, requests and deploys.

Shape of the fabricated data: 5 engineers with deliberately distinct profiles
(a high-volume generalist, a specialist deep in one repo, a prolific reviewer, a
steady mid-volume contributor, a recent joiner with a short history) across 5
repos. Approvals are distributed so the approvals matrix has a clear structure
rather than uniform noise, and a small number of merged-without-approval PRs
exist so that column is non-zero.

### 4. Request wiring

- `GET /api/insights?demo=1` — builds from the fixture and **never calls
  `getDb()`**. On Vercel this matters: `better-sqlite3` writes to a read-only
  filesystem, so the database must not be opened at all.
- `GET /api/roster?demo=1` — returns the 5 demo users and repos, all included.
- `POST /api/sync` and `POST /api/discover` with demo mode on — refuse with a
  clear message. `TeamTab`'s buttons render disabled with a tooltip saying why.

The client passes `demo=1` on every insights and roster fetch while the toggle is
on.

### 5. PRs created — column order

Current: `Engineer │ repo cols… │ PRs by engineer │ Services`
New: `Engineer │ PRs by engineer │ Services │ repo cols…`

`MatrixTable` gains `totalsPosition?: "leading" | "trailing"`, defaulting to
`"trailing"`. PRs created passes `"leading"`; Approvals keeps the default, so it
is not changed by a request that was not made about it.

`PRs by engineer` is sticky alongside the engineer name, so the headline number
stays visible while the repo columns scroll horizontally.

Affected internals: the axis banner `colSpan` arithmetic and the trailing
totals-row cells both assume totals sit last and need to follow the prop.

### 6. Motivational framing

- **Copy.** Rewrite all four tab descriptions toward contribution and recognition.
  The factual definitions stay — the leaderboard's explanation of what is actually
  measured is what makes it trustworthy — but the framing leads with what the
  engineer built rather than how they compare.
- **Breadth and volume.** The reorder in §5, with Services framed as the services
  an engineer has shipped into.
- **Callouts.** A highlights strip rendered **once, between the window toggle and
  the tab bar**, so the recognition is visible on every tab rather than buried in
  one: most services touched, most approvals given (helping others), fastest
  median. Each names an engineer. It derives from the same insights payload and
  respects the window toggle. Shown in both real and demo modes — the value is the
  same either way. When a category has no data it is omitted rather than shown
  empty.
- **De-ranking.** Drop the `#` column from the leaderboard, and **order the
  leaderboard alphabetically by engineer name** rather than by median
  (`src/lib/analytics/leaderboard.ts:68`). Median and average stay as columns;
  they are no longer the sort key, so the table stops reading as a scoreboard.
  This also makes all three tabs consistently alphabetical. The `byDisplayName`
  comparator already in `src/lib/analytics/matrices.ts` moves to a shared module.

**Documentation impact:** `CLAUDE.md` states the leaderboard is "ranked by
median" in two places. Both must be updated.

## Testing

- `src/lib/demo/fixture.test.ts` — determinism (same seed and `nowIso` produce
  identical output), all five users and repos present, both window settings
  non-empty, at least one merged-without-approval PR.
- `src/components/MatrixTable.test.tsx` — extend for `totalsPosition: "leading"`:
  correct column order, correct header alignment, totals row still aligned.
- `src/lib/analytics/leaderboard.test.ts` — update the ordering assertion from
  median-ascending to alphabetical.
- Existing analytics tests are otherwise untouched, since the maths does not
  change.

## Deployment

Vercel, no environment variables set. `demoAvailable` and `demoDefaultOn` both
resolve true, so the site loads populated with fabricated data on first paint.
`better-sqlite3` remains a dependency but is never invoked on that path.

**Scope boundary:** this spec covers making the app *deployable* in that state and
verifying it via a production build locally (`npm run build && npm start` with no
credentials present). Actually creating the Vercel project and connecting the repo
is a separate, manual step — it needs account access and is not implementable from
here.

## Risks

- **`better-sqlite3` on Vercel.** It is a native module and must still build
  during deployment even though it is never called at runtime. If the build
  fails, the fallback is a dynamic import so it is only required on the real-data
  path.
- **Demo data reading as fake.** If the numbers are obviously synthetic the
  portfolio value drops. Mitigated by the distinct engineer profiles in §3 rather
  than uniform random values.
