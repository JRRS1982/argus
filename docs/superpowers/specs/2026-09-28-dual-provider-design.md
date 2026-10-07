# Dual-provider Argus (Bitbucket + GitHub) — design

**Date:** 2026-09-28
**Status:** approved for planning
**Supersedes:** `2026-07-28-provider-agnostic-argus-design.md`

## Context

MVF has migrated from Bitbucket to GitHub. The migration is **rolling, not a cutover**: GitHub
repos under the `mvfglobal` org were created variously in April, May and September 2026, so each
service switched on its own date. A rolling six-month window today reaches back to 2026-03-28 and
therefore straddles the seam for most services. Measured: the first GitHub PR in the org is
2026-05-01, the cached Bitbucket history runs to 2026-08-27, so May–August 2026 carries real
activity on **both** providers simultaneously.

Argus currently reads Bitbucket only. Its cache holds **7,603 pull requests and 8,848 approvals
spanning 2016-04-06 to 2026-08-27**, across 768 discovered repos (51 included) and 61 users
(8 included).

Three facts discovered while investigating, each of which shaped this design:

1. **The August "dead repos" were not dead — they had moved.** The 2026-08-27 session concluded
   that `benchmarkme` and `chameleon-documentation` had been deleted from Bitbucket, and offered
   to remove them from the roster. Both exist on GitHub today. They 404'd on Bitbucket *because*
   they had been migrated. Acting on that offer would have discarded live history.

2. **Bitbucket permissions have since changed.** The token still authenticates, but repos that
   exist may no longer be visible to it. A Bitbucket 404 is therefore no longer good evidence that
   anything was deleted.

3. **Consequently the cache is no longer reproducible.** Ten years of Bitbucket history may not be
   re-fetchable at any price. This overturns the single most consequential assumption of the
   superseded spec.

## Relationship to the superseded spec

The 2026-07-28 spec was approved for planning but never implemented; the code still has
`src/lib/bitbucket/`, `src/types/index.ts` and a hardcoded `"mvfglobal"`. (One of its "incidental
fixes" — per-repo sync error isolation — was later landed standalone as `1c0246c`.)

**Adopted from it**

- Port + adapter over a normalised domain model, with the port in `providers/`.
- Per-record `Precision` (`exact` / `derived` / `fallback`) rather than a boolean fallback flag.
  With two providers live, precision varies *row by row inside one leaderboard*, so a per-record
  field is the only correct shape — a provider-wide flag cannot express it.
- Capability-driven copy: the UI renders caveats from `ProviderCapabilities`, never from hardcoded
  provider prose. GitHub reports exact merge timestamps; Bitbucket derives them from `updated_on`.
- `provider` as part of the pull-request primary key.
- A shared provider contract suite, run against every adapter.
- Normalising `DECLINED` / `SUPERSEDED` to a single `CLOSED` state.

**Overturned**

| Superseded decision | Replaced by | Why |
|---|---|---|
| "No GitHub provider in this pass" | GitHub adapter is the point of this pass | The migration happened |
| One provider selected by `ARGUS_PROVIDER` | Both providers active simultaneously | A service's history spans both; the UI must show one continuous record |
| "The SQLite cache is disposable"; drop and recreate on schema-version mismatch | **The cache is irreplaceable. Nothing is ever dropped.** | Bitbucket permissions changed; the history may be unrecoverable |
| Cross-provider identity not addressed | Canonical people and services with per-provider identities | Cannot arise under a single-provider design; unavoidable here |
| Both providers fetched | **Bitbucket frozen as a read-only archive; only GitHub is fetched** | Everything has migrated and Bitbucket permissions already lapsed once; not fetching it removes the risk rather than handling it |

**Deferred** (not required by dual-provider; a later cycle)

- The `core/` / `ui/` / `dashboard/` / `storage/` folder restructure.
- `architecture.test.ts` import-edge enforcement.
- Deleting the `"mvfglobal"` config default and the `ARGUS_WINDOW_MONTHS` extraction.

## Non-goals

- No change to any number the app reports for Bitbucket-sourced data. Where a figure changes it
  must be because GitHub data was added, never because Bitbucket data was reinterpreted.
- No pluggable storage. SQLite stays concrete.
- No auth, multi-user or deployment work. Argus stays a local single-user tool.
- No todo/kanban functionality. That brainstorm is parked and unrelated.

## Data preservation — a hard constraint

This is a requirement, not a risk to be mitigated.

- **Nothing in the migration issues `DROP TABLE`, `DELETE FROM`, or `TRUNCATE` against cached data.**
  Table rebuilds required by primary-key changes create the new table, copy every row in, then
  rename — all inside a single transaction.
- **The migration runner takes its own timestamped `VACUUM INTO` snapshot before touching anything**
  and refuses to proceed if that snapshot cannot be written and verified.
- **Post-migration assertion.** Row counts for `pull_requests` and `approvals` must exactly match
  the pre-migration counts. A mismatch rolls the whole transaction back and fails loudly.
- **Schema-version mismatch never destroys data.** An unrecognised (newer) version refuses to open
  with a clear message. It must not "rebuild".
- Pre-existing manual snapshots: `data/argus.backup-2026-09-28.sqlite` and
  `~/PersonalProjects/argus-backups/argus-premigration-2026-09-28.sqlite`, both verified at
  7,603 PRs / 8,848 approvals, `integrity_check: ok`.

## Canonical identity model

A **person** and a **service** are the things the UI shows. Each has one or more
**provider identities**. This is what lets a repo that moved appear as a single column with one
continuous history.

```
people(id, display_name, included)
person_identities(provider, account_id, person_id, PRIMARY KEY(provider, account_id))

services(id, name, included)
service_identities(provider, repo_key, service_id, default_branch, group_key,
                   state, last_synced_on, PRIMARY KEY(provider, repo_key))
```

`included` lives on the canonical entity, never on the identity: ticking a service includes it on
every provider it has ever lived on. That is the whole point.

## Schema and migration

Changed tables:

- `pull_requests` — primary key becomes `(provider, repo_key, number)`; gains `provider`,
  `service_id`, `person_id`, and `merged_on_precision` / `ready_for_review_precision` replacing
  `ready_is_fallback`.
- `approvals` — primary key becomes `(provider, repo_key, pr_number, approver_account_id)`; gains
  `provider`, `person_id`.
- `sync_state` — superseded by `service_identities.last_synced_on`, so each provider identity
  carries its own cursor.
- `users` / `repos` / `sync_state` — **retained untouched** as legacy tables. They are the source
  for `people` / `services` and cost a few hundred rows. Migration 1 does not drop them; a later
  migration may, once dual-provider has run in anger. Keeping them means Migration 1 is purely
  additive and the original data remains readable even if every new table were discarded.

`schema.ts` today is `CREATE TABLE IF NOT EXISTS` with no versioning. It gains a migration runner
keyed on `PRAGMA user_version`, applying numbered, forward-only, idempotent migrations.

**Migration 1** — additive, one transaction:

1. Snapshot and verify.
2. Create the new tables.
3. Insert one `people` row per existing `users` row, one `services` row per existing `repos` row,
   carrying `included` across verbatim.
4. Insert the matching `person_identities` / `service_identities` rows with `provider = 'bitbucket'`.
5. Rebuild `pull_requests` and `approvals` with the new keys, stamping `provider = 'bitbucket'` and
   resolving `person_id` / `service_id`; map `ready_is_fallback` to
   `fallback` / `derived` and set `merged_on_precision = 'derived'` for every Bitbucket row.
6. Assert row counts match. Roll back on any mismatch.

## Provider port

```ts
type DetailLevel = "summary" | "full";

type PullRequestProvider = {
  readonly id: string;                       // "bitbucket" | "github"
  readonly label: string;
  readonly capabilities: ProviderCapabilities;
  listPeople(): Promise<Person[]>;
  listRepositories(): Promise<Repository[]>;
  listPullRequests(repo: RepositoryRef, updatedSince: string, detail: DetailLevel)
    : Promise<FetchedPullRequest[]>;
};
```

Capabilities:

| | Bitbucket | GitHub |
|---|---|---|
| `mergeTimestamps` | `derived` (`updated_on` proxy) | `exact` (`merged_at`) |
| `readyForReviewTimestamps` | `onDemand` (activity feed) | `onDemand` (timeline events) |
| `approvalTimestamps` | `onDemand` | `exact` (reviews carry `submitted_at`) |
| `incrementalByUpdatedAt` | `true` | `true` |

`BitbucketApiError` generalises to a `ProviderApiError` base carrying `provider`, `status`,
`statusText` and `url`, so `sync`'s abort logic works without knowing the provider.
`describeHttpFailure` takes a provider label and the relevant credential variable names instead of
hardcoding Bitbucket's.

New `src/lib/github/`: `client.ts` (bearer auth, Link-header pagination, error mapping),
`discover.ts`, `pulls.ts`, `map.ts`, `index.ts`.

**The Bitbucket adapter is retained but never invoked by sync.** Since Bitbucket is archived, its
`listPullRequests` is dead code in normal operation, and the UI reads timestamp quality from the
stored per-record `Precision` columns rather than from its capabilities. It is kept anyway for two
reasons: re-enabling it is a config flip rather than a rewrite if permissions are ever restored, and
a port with only one live implementation drifts towards that implementation. The fixture provider
and the contract suite are the primary guard against that; the Bitbucket adapter is a second.

## Discover and auto-linking

Discovery runs per provider and links into canonical entities by normalised name (lower-cased,
`-` and `_` stripped). On a match it adds an identity to the existing entity; otherwise it creates
a new canonical entity, **excluded by default**, preserving the existing "a first run starts with
nothing selected" rule.

Measured against the 51 currently-included repos:

| Outcome | Count | Examples |
|---|---|---|
| Exact slug match on GitHub | 44 | auto-linked, no intervention |
| Renamed | 1 | `benchmarkmeapp` → `benchmarkme` |
| Never migrated | 6 | `chameleon-qa`, `minimise_renders_*`, `mvf-ui-library`, `sitemaps` |

So auto-linking carries ~86%, and exactly one service needs a manual link. `chameleon-qa` and
`chameleon-acceptance-tests` are confirmed **different repos** — `chameleon-qa` simply never
migrated, and must not be linked to it.

GitHub's `/orgs/{org}/members` returns the minimal user object with no `name`, so people discovery
uses a single GraphQL query to batch ~200 members rather than N+1 REST calls.

## The migration automation account

`mvfalcon` is the account that performed the cutover. It authored **796 of the org's 3,679 pull
requests (21.6%)** between 2026-06-05 and 2026-09-17 — CircleCI pipeline config, `CODEOWNERS`, and
similar per-repo plumbing, titled e.g. `cutover: add .github/CODEOWNERS`. It is not a copy of
anyone's Bitbucket work; 2,883 PRs are human-authored.

It must **stay excluded from the roster**. Included, it would rank first on the leaderboard by a
wide margin and dominate both matrices with automation noise. The existing "Discover adds everything
excluded by default" rule handles this automatically — the requirement is simply never to tick it,
and it is named here so a future reader does not tick it by mistake.

No special-casing in code: it is an ordinary excluded person. Encoding a hardcoded bot list would be
a rule the Team tab already expresses better.

## Bitbucket is a frozen archive

**Argus never writes to Bitbucket again.** Everything has migrated, the token's permissions have
already changed once, and the cached history is irreplaceable — so the safest and cheapest posture
is to stop fetching from it entirely and serve the 7,603 cached PRs as a read-only historical record.

This removes a class of work and risk rather than deferring it: no Bitbucket cursor to advance, no
incremental fetch, no 401/429 handling for a credential that may lapse at any time, and no way for a
Bitbucket outage or permission change to stall or corrupt a refresh. Only GitHub is ever fetched.

### Identity states

A provider identity has a `state`: `active`, `archived`, or `missing`.

- **Every Bitbucket identity is `archived`**, set once by Migration 1 rather than discovered through
  a 404. Its rows are retained and counted in every window; it is never fetched and never appears in
  the warning panel. This is the normal end state for a migrated repo, and it is a fact we assert
  rather than infer.
- **GitHub identities are `active`**, or `missing` on a 404 against the repo's own PR list, which
  surfaces in the warning panel exactly as today.
- **"Remove from roster" is offered only for a service whose every identity is `missing`.** A
  service holding archived Bitbucket history can never be offered for removal — that history is
  real and unrecoverable. This is the rule that would have prevented August's near-miss, when
  `benchmarkme` and `chameleon-documentation` were reported as deleted after merely moving.

Nothing is ever un-ticked automatically, as today.

## Sync

`syncAll` iterates `service_identities` whose service is included **and whose state is `active`** —
in practice, the GitHub identities. Archived identities are skipped without a request.

Because only one provider is ever fetched, the per-provider abort handling considered earlier is
unnecessary: the existing run-wide `401`/`429` abort and per-repo error isolation carry over
unchanged. That is a direct simplification bought by the archive decision.

### Depth

GitHub exposes `merged_at` directly, so the *end* of the review interval is exact for every PR with
no extra work — an immediate improvement on Bitbucket's `updated_on` proxy. The *start* is the
draft→ready transition, which needs one timeline call per PR.

- **Backfill runs deep**: roughly 2,900 timeline calls for the org's human-authored PRs, a one-off
  cost comfortably inside the 5,000/hour limit, yielding real ready-for-review times.
- **Incremental runs fast by default**, and may run deep when the changed set is small, since a
  daily refresh touches few PRs.

A PR whose ready time could not be derived keeps `ready_for_review_precision = 'fallback'` and the
leaderboard's `*` flag, as today — but after a deep backfill that should be rare on GitHub rows,
where today it is universal.

## Data freshness, per provider

The highlights strip's "Data refreshed" card currently shows a single newest-sync stamp. With two
providers that is misleading, because the two numbers mean different things and only one of them
ever moves again. The card lists both, labelled:

```
Data refreshed
GitHub      7 Oct 2026, 14:02      ← live; moves on every refresh
Bitbucket   archived 28 Sep 2026   ← frozen; will not change again
```

Bitbucket's line says **archived**, not "last pulled" — "last pulled" implies it might pull again,
which under this design it never will. `InsightsResponse.lastRefreshedAt` (today a
single nullable string) therefore becomes a small list — one entry per provider holding its id,
label, timestamp and whether it is archived — so the card renders from data rather than from a
hardcoded provider list. A provider with no data yet is omitted rather than shown as
"Never", so a GitHub-only instance shows one line and no confusing empty Bitbucket row. Demo mode
shows its per-request generation instant as a single line, as today.

## Analytics

Almost untouched — the payoff of the canonical model. `scope.ts` filters on canonical `person_id`
and `service_id`, so the four tabs never learn that providers exist, and the tab-reconciliation
guarantees in `CLAUDE.md` continue to hold across the seam.

The leaderboard's `*` caveat becomes per-row, driven by `ready_for_review_precision`, and the
explanatory prose is generated from the capabilities of the providers actually contributing rows.
Where every row is GitHub-sourced with exact timestamps, the "created → last touched" caveat is not
printed, because it would be false.

## Team tab

- Canonical people and services listed, each showing its provider identity badges (`BB`, `GH`) and
  their state.
- **Included entries sort to the top of the list**, excluded below, alphabetical within each group.
  With 768 discovered services this is what makes the list usable. The same comparator applies to
  people.
- A "same as…" control links an unlinked entity into an existing one; merges are reversible.
- The skipped-repo warning panel shows only `missing` GitHub identities. Archived Bitbucket
  identities are never listed as problems — being archived is their normal, expected state.

## Config

```
GITHUB_TOKEN, GITHUB_ORG            (GITHUB_ORG default: mvfglobal)
BITBUCKET_EMAIL, BITBUCKET_API_TOKEN, BITBUCKET_WORKSPACE, BITBUCKET_PROJECT_KEY
ARGUS_DB_PATH
```

A provider is active only if its credentials are present, so Argus runs GitHub-only, Bitbucket-only
or both without code changes. `isDemoAvailable` generalises from "no Bitbucket credentials" to
"no provider configured".

## Testing

- The existing 127 tests must stay green throughout; they are the behaviour-parity check.
- `providers/contract.ts` — a shared suite every adapter passes, run against Bitbucket, GitHub and
  a fixture provider.
- `github/map.test.ts` — raw GitHub payloads to domain, including state normalisation and precision.
- **Migration tests are the highest-value tests here**: build a fixture database in the pre-migration
  schema, run the migration, and assert every PR and approval survives with correct provider stamps
  and resolved canonical ids; assert a deliberately corrupted migration rolls back with the original
  data intact.
- Auto-linking unit tests covering exact match, rename, and no-match.

## Sequence

1. Migration runner and Migration 1, with tests. **Nothing else lands until data preservation is
   proven.**
2. Canonical identity model and query layer.
3. Provider port; refactor Bitbucket behind it. No behaviour change.
4. GitHub adapter, against the contract suite.
5. Discover auto-linking; sync active identities only; archived-state handling.
6. Team tab: badges, included-first ordering, merge control.
7. Capability-driven copy; per-row precision.
8. Update `CLAUDE.md` and `README.md`.

## Risks

- **Data loss during migration.** The dominant risk, and the reason step 1 lands alone behind
  verified snapshots, an in-transaction rebuild and a row-count assertion.
- **Bitbucket visibility is already degraded.** Largely neutralised: Bitbucket is never fetched, so
  a revoked permission or a deleted repo cannot affect a refresh or a cached row at all. The cost is
  that any PR still merged to Bitbucket after the archive date is invisible — accepted, since
  everything has migrated.
- **Identity auto-linking is a heuristic.** Measured at ~86%; the merge control is the escape hatch,
  and a wrong link is reversible.
- **Duplicate PRs — measured, and effectively absent.** The concern was that a mirrored repo could
  hold the same logical PR on both providers. Verified against the live org: **no GitHub PR predates
  2026-01-01** and the earliest in the org is 2026-05-01, so Bitbucket history was never replayed.
  The May–August 2026 overlap is *genuine concurrent activity* during the rolling cutover, not
  duplication, and canonical identity is exactly what merges it correctly. No dedupe logic is
  planned. If duplicates ever surface, dedupe on title plus merge timestamp within a service.
