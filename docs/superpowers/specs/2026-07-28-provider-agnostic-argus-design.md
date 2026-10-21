# Provider-agnostic Argus — design

> **SUPERSEDED (2026-09-28)** by `2026-09-28-dual-provider-design.md`.
>
> This design was approved but never implemented. Two of its decisions are now unsafe:
> it assumes **one provider at a time** (MVF now needs Bitbucket and GitHub live together),
> and it declares the **SQLite cache disposable** — no longer true, since Bitbucket
> permissions changed and the cached history may be unrecoverable. Its port + adapter,
> per-record `Precision`, capability-driven copy and contract suite are carried forward.

**Date:** 2026-07-28
**Status:** superseded — see `2026-09-28-dual-provider-design.md`

## Context

Argus was built against Bitbucket at MVF. It works, and its analytics are careful, but three
things stop it being reusable elsewhere:

1. **MVF specifics are baked in.** `config/index.ts` defaults the workspace to `"mvfglobal"`.
2. **Bitbucket vocabulary is the domain vocabulary.** `accountId`, `repoSlug`, `projectKey`,
   `workspace`, and a `PullRequestState` that includes `SUPERSEDED` — a Bitbucket-only state —
   reach all the way into the analytics and the React components.
3. **Provider limitations are hardcoded as UI prose.** The leaderboard explains at length that it
   measures "created → last touched" because Bitbucket's PR list exposes no merge timestamp. That
   caveat is true of Bitbucket and false of GitHub, but it lives in a component.

The goal is to be able to point Argus at a different provider — GitHub, or something else — by
writing one adapter, without touching analytics, storage, or UI. And to keep the data-fetching
concern separate from the presentational one.

## Non-goals

- **No GitHub provider in this pass.** The port is proven by two implementations (Bitbucket and an
  in-memory fixture), not by speculatively writing a third.
- **No pluggable storage.** SQLite stays concrete. The requirement is a cache that avoids repeat
  requests, not a swappable persistence layer.
- **No auth, multi-user, or deployment work.** Argus stays a local single-user tool.
- **No change to any number the app reports.** This is a restructure. If a figure on any tab
  changes, that is a bug in the refactor.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Provider abstraction | Port + adapter over a normalised domain model | The alternative — keeping today's injected fetch functions — leaves Bitbucket vocabulary in the domain and gives capability differences nowhere to live |
| GitHub adapter now? | No | YAGNI. The fixture provider is the second implementation that keeps the port honest |
| Packaging | Single Next.js app, boundaries enforced by test | No workspace tooling for a solo tool; extracting packages later is a small job |
| Code migration | Preserve full git history | Done — 20 commits imported, plus one commit landing work the source repo never committed |
| Name | Argus retained; GitHub repo renamed to `JRRS1982/argus` | Done |
| Provider quirks | Providers declare capabilities; UI renders caveats from data | A provider with real merge timestamps must stop printing a caveat that does not apply to it |
| PR state model | Normalise to `OPEN` / `MERGED` / `CLOSED` | `DECLINED` and `SUPERSEDED` are already treated identically (both excluded), so collapsing them changes nothing except portability |
| Folder layout | Architecture folders top-level under `src/` | Next.js is explicitly unopinionated outside `app/`; these folders *are* the architecture, not a `lib/` utility drawer |
| Boundary enforcement | Vitest test, not ESLint | Zero new dependencies, runs with `npm test` |

### Assumptions carried into the plan

- The fold-in fixes in "Incidental fixes" below are in scope: the user asked for a code review and
  "any follow up work that may be required", and each one is a boundary violation that this
  restructure exists to remove.
- The SQLite cache is disposable. Column renames mean existing cache files are incompatible; a
  schema-version check rebuilds rather than crashing.

## Structure

```
src/
  app/                  ROUTING ONLY
    page.tsx            renders <Dashboard />, nothing else
    layout.tsx, globals.css
    api/{discover,roster,sync,insights}/route.ts
  dashboard/            container layer: state + data fetching
    Dashboard.tsx, useInsights.ts, useRoster.ts, api-client.ts
  ui/                   presentational only: props in, JSX out
    Tabs, TeamPanel, LeaderboardTable, MatrixTable, RangeToggle, copy.ts
  core/                 pure domain — no React, no Next, no SQLite, no fetch
    domain/ capabilities/ window/ analytics/ view/
  providers/
    provider.ts         the port
    contract.ts         shared suite every provider must pass
    registry.ts         name -> factory, driven by config
    bitbucket/          client, map, discover, pulls, index
    fixture/            in-memory provider: test double + credential-free demo
  storage/              db, schema, queries
  sync/                 orchestrator
  config/
```

This is the Next.js docs' first documented strategy — "store project files outside of `app`" —
which "keeps the `app` directory purely for routing purposes", plus the optional `src/` folder.

**Allowed import edges.** `core` imports nothing internal. `providers`, `storage`, `ui` → `core`
only. `sync` → `core` + the port + `storage`. `dashboard` → `core` + `ui`. `app` → anything.
`core` may not import `react`, `next`, or `better-sqlite3`.

`src/architecture.test.ts` reads every file's import statements and fails on a violated edge. A
documented convention nobody checks is not a boundary.

## The port

`Precision` and `ProviderCapabilities` are **domain types and live in `core/`**, not in
`providers/`. This matters: `ui/` renders caveats from capabilities, and `ui/` may only import from
`core/`. The port interface itself lives in `providers/provider.ts` and references core types.

```ts
// core/domain — a per-record statement of how good a timestamp is
type Precision = "exact" | "derived" | "fallback";

// core/capabilities — what a provider can tell you, independent of who it is
type ProviderCapabilities = {
  mergeTimestamps: "exact" | "derived";
  // "unavailable" implies every readyForReviewPrecision is "fallback"
  readyForReviewTimestamps: "exact" | "onDemand" | "unavailable";
  approvalTimestamps: "exact" | "onDemand" | "unavailable";
  incrementalByUpdatedAt: boolean;
};

// providers/provider.ts
type DetailLevel = "summary" | "full";

type RepositoryRef = { id: string; defaultBranch: string };

type FetchedPullRequest = {
  pullRequest: PullRequest;
  approvals: Approval[];
  // true  -> this list is the complete approval history; storage replaces.
  // false -> this list is what the summary endpoint happened to expose; storage merges.
  approvalsAreComplete: boolean;
};

type PullRequestProvider = {
  readonly id: string;
  readonly label: string;
  readonly capabilities: ProviderCapabilities;
  listPeople(): Promise<Person[]>;
  listRepositories(): Promise<Repository[]>;
  listPullRequests(
    repo: RepositoryRef,
    updatedSince: string,
    detail: DetailLevel,
  ): Promise<FetchedPullRequest[]>;
};
```

Bitbucket's capabilities: `mergeTimestamps: "derived"` (the `updated_on` proxy),
`readyForReviewTimestamps: "onDemand"`, `approvalTimestamps: "onDemand"`,
`incrementalByUpdatedAt: true`.

**`fast`/`deep` becomes `detail: "summary" | "full"`.** Today's sync knows that a deep sync means
one `/activity` call per PR — a Bitbucket implementation detail. Under the port, `detail` states
intent and the adapter decides how to satisfy it. Sync goes from taking two injected fetch
functions to taking one provider.

**`approvalsAreComplete` preserves existing behaviour exactly.** Today the fast path calls
`mergeApprovals` (additive, cannot observe withdrawn approvals) and the deep path calls
`replaceApprovals` (authoritative). That distinction is real and must survive the abstraction; this
flag is its provider-neutral expression.

## Domain model

| Today | New | Note |
|---|---|---|
| `PullRequestRecord` | `PullRequest` | |
| `.id` | `.number` | it is a per-repo number, not a global id |
| `.repoSlug` | `.repositoryId` | |
| `.authorAccountId` | `.authorId` | |
| `.readyIsFallback: boolean` | `.readyForReviewPrecision: Precision` | `false` → `"derived"`, `true` → `"fallback"` |
| `.mergedOn` | `.mergedOn` + `.mergedOnPrecision` | Bitbucket sets `"derived"` |
| `PullRequestState` (4 values) | `"OPEN" \| "MERGED" \| "CLOSED"` | `DECLINED`/`SUPERSEDED` → `CLOSED` |
| `ApprovalRecord` | `Approval` | |
| `.prId` / `.approverAccountId` | `.pullRequestNumber` / `.approverId` | |
| `UserRecord` | `Person` | `.accountId` → `.id` |
| `RepoRecord` | `Repository` | `.slug` → `.id`, `.projectKey` → `.group`, `.mainBranch` → `.defaultBranch` |
| `InsightsWindow = "6m" \| "all"` | `AnalysisWindow = "recent" \| "all"` | `"6m"` hardcodes a configurable number; the API query param changes from `?window=6m` to `?window=recent` |

`src/types/index.ts` — a single global types file — is dissolved into `core/domain/` (records) and
`core/view/` (view models the analytics produce).

## Storage

- Columns take the neutral names above.
- Primary key becomes `(provider_id, repository_id, number)`. Switching providers cannot collide in
  one cache file.
- New `cache_meta` table holding a schema version. On mismatch, drop and recreate rather than
  crashing on an incompatible file.
- Query functions stay pure over an injected `Database` handle, as today.

## Capability-driven copy

`ui/copy.ts` holds every word of explanatory prose in one place, generated from
`ProviderCapabilities` plus per-record `Precision` rather than hardcoded. With Bitbucket selected
the leaderboard says what it says today. A provider reporting `mergeTimestamps: "exact"` stops
printing the "created → last touched" caveat, because it would be a lie.

For the UI to do this, the capabilities have to reach it: `InsightsResponse` (in `core/view/`)
gains `provider: { id: string; label: string; capabilities: ProviderCapabilities }`, populated by
the insights route from the selected provider. The UI never learns *which* provider it is beyond a
display label — it reads capabilities.

Bitbucket-specific copy assertions move from component tests to the Bitbucket adapter's tests.

## Config

```
ARGUS_PROVIDER      = bitbucket          (default: bitbucket)
ARGUS_DB_PATH       = data/argus.sqlite
ARGUS_WINDOW_MONTHS = 6                  (default: 6)
BITBUCKET_EMAIL, BITBUCKET_API_TOKEN, BITBUCKET_WORKSPACE   (required, no default)
BITBUCKET_PROJECT_KEY                                        (optional)
```

The `"mvfglobal"` default is deleted; workspace becomes required and fails with a clear message.
`ARGUS_WINDOW_MONTHS` replaces the magic 6 currently hardcoded in both the sync backfill and the
rolling read window, so the UI's "Last 6 months" label stays truthful if it changes. Each provider
factory validates its own config.

## Incidental fixes

Each of these is a boundary violation this restructure exists to remove, so they are folded in
rather than deferred:

- **`MatrixTable` knows about approvals.** It infers the greyed diagonal from
  `c.key === u.accountId` and hardcodes the tooltip "approves the most of X's PRs" — the approvals
  tab leaking into a generic component. Becomes explicit props.
- **`syncAll` loses everything on one failure.** It is sequential with no per-repo error handling,
  so one failing repo aborts the rest and reports nothing. Becomes per-repo capture returning
  partial results plus an `errors` array; the route returns 200 with partial data, 500 only if
  every repo failed; the UI surfaces the failures.
- **`page.tsx` does everything.** ~600 words of prose and all the data fetching. Prose →
  `ui/copy.ts`, fetching → `dashboard/`, leaving a routing-only `app/page.tsx`.
- **`.env.local.example` is not tracked.** `.gitignore` has a blanket `.env*` with no negation, so
  a fresh clone has no example to copy. Add `!.env*.example`.
- **Dead config.** `.env.local.example` declares `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_BASE_URL`
  for an integration that does not exist — `CLAUDE.md` says so explicitly. Remove.

## Testing

- The existing 63 tests migrate with the renames. Their substance must not change: they are the
  behaviour-parity check for the whole refactor.
- `providers/bitbucket/map.test.ts` — raw Bitbucket payloads → domain, including state
  normalisation and precision flags.
- `providers/contract.ts` — `describeProviderContract(name, factory)`, a shared suite any provider
  must pass, run against the fixture provider. This is what makes adding GitHub safe later.
- `sync.test.ts` — its hand-rolled fake fetch functions are replaced by the fixture provider, which
  is the fixture's main justification.
- `architecture.test.ts` — the import-edge rules above.

## Sequence

1. ~~Rename the GitHub repo, update the local remote.~~ Done.
2. ~~Import history and land the source repo's uncommitted work.~~ Done — 21 commits, 63 tests green.
3. Restructure on `feat/provider-agnostic-restructure`, tests green at every step.
4. Code review; fix what it finds.
5. Rewrite `CLAUDE.md` and `README.md` provider-neutrally.

## Risks

- **The renames touch nearly every file.** Mitigation: no behaviour change is intended, the test
  suite is the check, and steps are small enough to keep it green throughout.
- **Existing cache files become unreadable.** Mitigation: the `cache_meta` version check rebuilds
  automatically. The cache is gitignored and re-syncable, so nothing is lost but time.
- **A port with one real adapter can still be shaped wrong.** Mitigation: the fixture provider and
  the contract suite. Accepted residual risk: the first real second provider will probably still
  want small changes.
