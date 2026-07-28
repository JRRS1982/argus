# Provider-agnostic Argus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure Argus so a different PR host (GitHub, or anything else) can be supported by writing one adapter, without touching analytics, storage, or UI — and so presentational components are separate from data fetching.

**Architecture:** A `PullRequestProvider` port over a provider-neutral domain model. `core/` holds pure domain types and analytics and imports nothing internal; `providers/` adapts a specific host into `core/` types and declares its capabilities; `storage/` caches; `sync/` orchestrates; `ui/` is presentational-only; `dashboard/` owns state and fetching; `app/` is routing-only. Import direction is enforced by a test.

**Tech Stack:** Next.js 16 (App Router), TypeScript, React 19, better-sqlite3, Tailwind CSS v4, Vitest + @testing-library/react.

## Global Constraints

- **No behaviour change.** This is a restructure. If any number on any tab changes, that is a bug. The existing 63 tests are the parity check — their *substance* must not change, only names and import paths.
- **Every task ends green.** `npm test` (all tests) and `npx tsc --noEmit` (no type errors) must both pass before committing. Never commit red.
- **`core/` imports nothing internal** and must never import `react`, `next`, `next/server`, or `better-sqlite3`.
- **Only `app/` imports `config/`.** Every other layer receives what it needs as an argument. This is what keeps `core/`, `storage/`, and `providers/` unit-testable without environment variables.
- **Path alias:** `@/x` resolves to `src/x`. All moves stay inside `src/`, so no alias config changes are needed. If `vitest.config.ts` declares its own `@` alias, leave it alone.
- **Never commit secrets.** `.env.local` is gitignored and must stay that way. Only `.env*.example` becomes tracked.
- **SQLite cache is disposable.** Any task changing the schema bumps `SCHEMA_VERSION`, which triggers an automatic rebuild. Never write a data migration.
- **Repo commit convention:** messages are normally prefixed with the branch name (e.g. `GOLD-123: …`) via the `gc` shell helper or `/dotfiles-gc`. On this feature branch plain conventional-commit messages are used, as shown in each task's commit step.
- **Work on branch `feat/provider-agnostic-restructure`,** created from `main` in Task 0.

---

## File Structure

**Target layout** (end state; folders arrive progressively):

| Path | Responsibility |
|---|---|
| `src/core/domain/pull-request.ts` | `PullRequest`, `PullRequestState`, `Precision`, `Approval` |
| `src/core/domain/people.ts` | `Person`, `Repository` |
| `src/core/capabilities/index.ts` | `ProviderCapabilities`, `ProviderInfo` |
| `src/core/window/index.ts` | `AnalysisWindow`, `resolveSinceIso`, `formatWindowLabel`, `monthsAgoIso` |
| `src/core/analytics/{scope,duration,leaderboard,matrices}.ts` | pure analytics, unchanged logic |
| `src/core/view/insights.ts` | `LeaderboardRow`, `LeaderboardPR`, `Matrix`, `InsightsResponse` |
| `src/providers/provider.ts` | the port: `PullRequestProvider`, `DetailLevel`, `RepositoryRef`, `FetchedPullRequest` |
| `src/providers/provider-contract.ts` | `describeProviderContract` — shared suite every provider must pass |
| `src/providers/registry.ts` | `createProvider(config)` — name → factory |
| `src/providers/bitbucket/{client,map,discover,pulls,index}.ts` | Bitbucket adapter |
| `src/providers/fixture/index.ts` | in-memory provider: test double + credential-free demo |
| `src/storage/{db,schema}.ts` | handle, pragmas, schema, version-based rebuild |
| `src/storage/queries/index.ts` | pure query functions over an injected handle |
| `src/sync/sync.ts` | orchestrator: provider + storage → cache, per-repo error capture |
| `src/ui/{Tabs,TeamPanel,LeaderboardTable,MatrixTable,RangeToggle}.tsx` | presentational only |
| `src/ui/copy.ts` | every word of explanatory prose, generated from capabilities |
| `src/dashboard/{Dashboard.tsx,useInsights.ts,useRoster.ts,api-client.ts}` | state + fetching |
| `src/app/page.tsx` | renders `<Dashboard />`, nothing else |
| `src/app/api/{discover,roster,sync,insights}/route.ts` | HTTP edge; wires config → provider → storage |
| `src/config/index.ts` | env parsing and validation |
| `src/architecture.test.ts` | enforces the import edges |

**Files deleted by the end:** `src/types/index.ts` (dissolved into `core/domain` + `core/view`), `src/lib/` (emptied), `src/components/` (emptied).

---

### Task 0: Branch and baseline

**Files:** none modified.

**Interfaces:**
- Consumes: nothing.
- Produces: branch `feat/provider-agnostic-restructure` at the same commit as `main`; a recorded baseline test count later tasks compare against.

- [ ] **Step 1: Create the branch**

```bash
git checkout main
git checkout -b feat/provider-agnostic-restructure
```

- [ ] **Step 2: Record the green baseline**

Run: `npm test`
Expected: `Test Files 10 passed (10)`, `Tests 63 passed (63)`.

If the count differs from 63, stop and report — the plan's parity assumption is broken.

- [ ] **Step 3: Confirm types are clean before any change**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

---

### Task 1: Config and environment hygiene

Removes the MVF default and the magic 6, and fixes the example env file nobody can copy.

**Files:**
- Modify: `src/config/index.ts` (full rewrite, 11 lines → ~60)
- Create: `src/config/index.test.ts`
- Modify: `.gitignore` (add one negation line)
- Modify: `.env.local.example`
- Modify: `src/app/api/discover/route.ts`, `src/app/api/sync/route.ts` (call sites of `config.workspace` / `config.projectKey`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type AppConfig = { providerName: string; dbPath: string; windowMonths: number }`
  - `type BitbucketConfig = { email: string; apiToken: string; workspace: string; projectKey: string | null }`
  - `readAppConfig(env: Record<string, string | undefined>): AppConfig`
  - `readBitbucketConfig(env: Record<string, string | undefined>): BitbucketConfig`
  - `export const config: AppConfig` — `readAppConfig(process.env)`, for route use only

Both readers take `env` explicitly so they are testable without mutating `process.env`.

- [ ] **Step 1: Write the failing tests**

Create `src/config/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readAppConfig, readBitbucketConfig } from "./index";

describe("readAppConfig", () => {
  it("defaults provider, db path, and window months", () => {
    const c = readAppConfig({});
    expect(c).toEqual({ providerName: "bitbucket", dbPath: "data/argus.sqlite", windowMonths: 6 });
  });

  it("reads overrides from the environment", () => {
    const c = readAppConfig({
      ARGUS_PROVIDER: "fixture",
      ARGUS_DB_PATH: "/tmp/x.sqlite",
      ARGUS_WINDOW_MONTHS: "3",
    });
    expect(c).toEqual({ providerName: "fixture", dbPath: "/tmp/x.sqlite", windowMonths: 3 });
  });

  it("rejects a window that is not a positive integer", () => {
    expect(() => readAppConfig({ ARGUS_WINDOW_MONTHS: "0" })).toThrow(/ARGUS_WINDOW_MONTHS/);
    expect(() => readAppConfig({ ARGUS_WINDOW_MONTHS: "abc" })).toThrow(/ARGUS_WINDOW_MONTHS/);
    expect(() => readAppConfig({ ARGUS_WINDOW_MONTHS: "1.5" })).toThrow(/ARGUS_WINDOW_MONTHS/);
  });
});

describe("readBitbucketConfig", () => {
  const complete = {
    BITBUCKET_EMAIL: "a@b.com",
    BITBUCKET_API_TOKEN: "tok",
    BITBUCKET_WORKSPACE: "acme",
  };

  it("reads credentials and workspace, with projectKey optional", () => {
    expect(readBitbucketConfig(complete)).toEqual({
      email: "a@b.com", apiToken: "tok", workspace: "acme", projectKey: null,
    });
    expect(readBitbucketConfig({ ...complete, BITBUCKET_PROJECT_KEY: "PROJ" }).projectKey).toBe("PROJ");
  });

  it("names every missing variable in one error", () => {
    expect(() => readBitbucketConfig({})).toThrow(
      /BITBUCKET_EMAIL.*BITBUCKET_API_TOKEN.*BITBUCKET_WORKSPACE/s,
    );
  });

  it("has no default workspace", () => {
    const { BITBUCKET_WORKSPACE: _omitted, ...withoutWorkspace } = complete;
    expect(() => readBitbucketConfig(withoutWorkspace)).toThrow(/BITBUCKET_WORKSPACE/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/config/index.test.ts`
Expected: FAIL — `readAppConfig` / `readBitbucketConfig` are not exported.

- [ ] **Step 3: Rewrite the config module**

Replace the whole contents of `src/config/index.ts`:

```ts
export type AppConfig = {
  providerName: string;  // which provider adapter to use
  dbPath: string;        // path to the SQLite cache file
  windowMonths: number;  // rolling analysis window, and the sync backfill depth
};

export type BitbucketConfig = {
  email: string;
  apiToken: string;
  workspace: string;
  projectKey: string | null; // null = the whole workspace
};

type Env = Record<string, string | undefined>;

const positiveInt = (raw: string | undefined, name: string, fallback: number): number => {
  if (raw === undefined || raw === "") return fallback;
  // Number() rather than parseInt: parseInt("1.5") is 1, which would silently
  // accept a value the user got wrong.
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${name} must be a positive whole number, got "${raw}"`);
  }
  return n;
};

export const readAppConfig = (env: Env): AppConfig => ({
  providerName: env.ARGUS_PROVIDER ?? "bitbucket",
  dbPath: env.ARGUS_DB_PATH ?? "data/argus.sqlite",
  windowMonths: positiveInt(env.ARGUS_WINDOW_MONTHS, "ARGUS_WINDOW_MONTHS", 6),
});

// Reports every missing variable at once: fixing them one error at a time is
// needless round-trips through a failed request.
export const readBitbucketConfig = (env: Env): BitbucketConfig => {
  const required = ["BITBUCKET_EMAIL", "BITBUCKET_API_TOKEN", "BITBUCKET_WORKSPACE"] as const;
  const missing = required.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `Copy .env.local.example to .env.local and fill them in.`,
    );
  }
  return {
    email: env.BITBUCKET_EMAIL!,
    apiToken: env.BITBUCKET_API_TOKEN!,
    workspace: env.BITBUCKET_WORKSPACE!,
    projectKey: env.BITBUCKET_PROJECT_KEY ?? null,
  };
};

// Convenience singleton for route handlers. Library code takes config as an
// argument instead, so it stays testable without the environment.
export const config: AppConfig = readAppConfig(process.env);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/config/index.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Update the two call sites that used `config.workspace`**

`config` no longer carries `workspace` or `projectKey`. In both `src/app/api/discover/route.ts` and `src/app/api/sync/route.ts`, replace the `import { config } from "@/config"` usage:

- Add `import { readBitbucketConfig } from "@/config";`
- Inside the `try` block, before first use: `const bb = readBitbucketConfig(process.env);`
- Replace `config.workspace` → `bb.workspace` and `config.projectKey` → `bb.projectKey`.

Leave `getAuthHeader()` alone for now; Task 9 replaces it.

- [ ] **Step 6: Fix the example env file**

Replace the whole contents of `.env.local.example`:

```
# Bitbucket API credentials — generate at https://id.atlassian.com/manage-profile/security/api-tokens
# Required permissions: Repositories (Read), Pull requests (Read), Account (Read)
BITBUCKET_EMAIL=your.email@somewhere.com
BITBUCKET_API_TOKEN=your_bitbucket_api_token

# Workspace to read from — required, no default.
BITBUCKET_WORKSPACE=your-workspace-slug
# BITBUCKET_PROJECT_KEY=PROJ        # optional: limit discovered repos to one project

# Optional app settings
# ARGUS_PROVIDER=bitbucket          # which provider adapter to use
# ARGUS_DB_PATH=data/argus.sqlite   # override the local cache location
# ARGUS_WINDOW_MONTHS=6             # rolling analysis window and sync backfill depth
```

The `JIRA_EMAIL` / `JIRA_API_TOKEN` / `JIRA_BASE_URL` lines are deleted — there is no Jira integration.

- [ ] **Step 7: Make the example file trackable**

In `.gitignore`, find the line `.env*` and add a negation immediately after it:

```
# env files (can opt-in for committing if needed)
.env*
!.env*.example
```

- [ ] **Step 8: Verify the example file is now tracked and the real one is not**

Run: `git check-ignore -v .env.local .env.local.example; git status --short`
Expected: `.env.local` reported as ignored; `.env.local.example` NOT reported as ignored.

Run: `git status --short | grep -c "\.env\.local$"`
Expected: `0` — the real env file must never appear as a candidate for staging.

- [ ] **Step 9: Full verification**

Run: `npm test && npx tsc --noEmit`
Expected: 70 tests pass (63 + 7 new), no type errors.

- [ ] **Step 10: Commit**

```bash
git add src/config .env.local.example .gitignore src/app/api/discover/route.ts src/app/api/sync/route.ts
git commit -m "refactor: make config provider-neutral and validated

Removes the hardcoded mvfglobal workspace default and the magic 6-month
window, both of which were policy baked into code. Workspace is now
required with an error naming every missing variable at once.

Also tracks .env.local.example, which a blanket .env* ignore had been
hiding from every fresh clone, and drops its dead JIRA_* vars."
```

---

### Task 2: Storage schema versioning and automatic rebuild

Must land before any schema change, so the next four tasks can alter columns freely.

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/index.ts`
- Create: `src/lib/db/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const SCHEMA_VERSION = 1` in `schema.ts` — every later schema-changing task increments this
  - `applySchema(db: Database.Database): void` — unchanged signature, now rebuilds on version mismatch
  - `getDb(dbPath: string): Database.Database` — **signature change**: takes the path instead of reading `config`

- [ ] **Step 1: Write the failing test**

Create `src/lib/db/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applySchema, SCHEMA_VERSION } from "./schema";

const memoryDb = () => new Database(":memory:");

describe("applySchema", () => {
  it("records the current schema version", () => {
    const db = memoryDb();
    applySchema(db);
    const row = db.prepare("SELECT version FROM cache_meta").get() as { version: number };
    expect(row.version).toBe(SCHEMA_VERSION);
  });

  it("is idempotent and preserves data when the version matches", () => {
    const db = memoryDb();
    applySchema(db);
    db.prepare("INSERT INTO users (account_id, display_name, included) VALUES ('a', 'Ada', 1)").run();
    applySchema(db);
    const users = db.prepare("SELECT account_id FROM users").all();
    expect(users).toHaveLength(1);
  });

  it("drops and rebuilds when the stored version is older", () => {
    const db = memoryDb();
    applySchema(db);
    db.prepare("INSERT INTO users (account_id, display_name, included) VALUES ('a', 'Ada', 1)").run();
    // Simulate a cache written by an older build.
    db.prepare("UPDATE cache_meta SET version = ?").run(SCHEMA_VERSION - 1);

    applySchema(db);

    const users = db.prepare("SELECT account_id FROM users").all();
    expect(users).toEqual([]); // rebuilt, not migrated
    const row = db.prepare("SELECT version FROM cache_meta").get() as { version: number };
    expect(row.version).toBe(SCHEMA_VERSION);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/db/schema.test.ts`
Expected: FAIL — `SCHEMA_VERSION` is not exported and `cache_meta` does not exist.

- [ ] **Step 3: Add versioning to the schema module**

In `src/lib/db/schema.ts`, keep `SCHEMA_SQL` exactly as it is and add `cache_meta` to it:

```sql
CREATE TABLE IF NOT EXISTS cache_meta (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL
);
```

Then replace the exported `applySchema` with:

```ts
// Bumped by any change to SCHEMA_SQL. The cache is derived data that can always
// be re-synced, so a version mismatch rebuilds it rather than migrating —
// migrations are a cost worth paying for user data, not for a cache.
export const SCHEMA_VERSION = 1;

const TABLES = ["cache_meta", "users", "repos", "pull_requests", "approvals", "sync_state"] as const;

const storedVersion = (db: Database.Database): number | null => {
  const present = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cache_meta'`)
    .get();
  if (!present) return null;
  const row = db.prepare(`SELECT version FROM cache_meta WHERE id = 1`).get() as
    | { version: number }
    | undefined;
  return row?.version ?? null;
};

export const applySchema = (db: Database.Database): void => {
  const found = storedVersion(db);
  if (found !== null && found !== SCHEMA_VERSION) {
    // Drop in reverse dependency order. No foreign keys are declared between
    // these tables, but the order costs nothing and survives adding some.
    for (const table of [...TABLES].reverse()) db.exec(`DROP TABLE IF EXISTS ${table}`);
  }
  db.exec(SCHEMA_SQL);
  db.prepare(
    `INSERT INTO cache_meta (id, version) VALUES (1, @version)
     ON CONFLICT(id) DO UPDATE SET version = excluded.version`,
  ).run({ version: SCHEMA_VERSION });
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/db/schema.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Make `getDb` take its path**

`src/lib/db/index.ts` reads `config.dbPath` directly, which makes storage depend on the environment. Replace the module contents:

```ts
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { applySchema } from "./schema";

const instances = new Map<string, Database.Database>();

// One handle per path, reused across requests. Keyed by path rather than a bare
// singleton so tests can open an independent cache without leaking into the app's.
export const getDb = (dbPath: string): Database.Database => {
  const existing = instances.get(dbPath);
  if (existing) return existing;
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applySchema(db);
  instances.set(dbPath, db);
  return db;
};
```

- [ ] **Step 6: Update the four route call sites**

In each of `src/app/api/{discover,roster,sync,insights}/route.ts`, replace `getDb()` with `getDb(config.dbPath)` and ensure `import { config } from "@/config";` is present. `roster/route.ts` and `insights/route.ts` do not currently import config — add the import to both.

- [ ] **Step 7: Full verification**

Run: `npm test && npx tsc --noEmit`
Expected: 73 tests pass, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/db src/app/api
git commit -m "feat: version the sqlite cache and rebuild on mismatch

The cache is derived data, so an incompatible schema should rebuild rather
than crash on an old file or need a migration. Later tasks change columns
freely by bumping SCHEMA_VERSION.

getDb now takes its path instead of reading config, so storage no longer
depends on the environment."
```

---

### Task 3: Normalise pull request state to OPEN / MERGED / CLOSED

`SUPERSEDED` is a Bitbucket-only state. `DECLINED` and `SUPERSEDED` are already treated identically everywhere (both excluded from every tab), so collapsing them changes no output.

**Files:**
- Modify: `src/types/index.ts` (the `PullRequestState` union)
- Modify: `src/lib/bitbucket/pulls.ts` (add the mapping)
- Modify: `src/lib/bitbucket/pulls.test.ts` (assert the mapping)
- Modify: `src/lib/db/schema.ts` (bump `SCHEMA_VERSION` to 2)
- Check: `src/lib/analytics/scope.ts`, `src/lib/analytics/matrices.ts`, `src/lib/analytics/leaderboard.ts` and their tests for any literal `"DECLINED"` / `"SUPERSEDED"`

**Interfaces:**
- Consumes: `SCHEMA_VERSION` from Task 2.
- Produces:
  - `type PullRequestState = "OPEN" | "MERGED" | "CLOSED"`
  - `normaliseBitbucketState(raw: string): PullRequestState` exported from `src/lib/bitbucket/pulls.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/bitbucket/pulls.test.ts`:

```ts
import { normaliseBitbucketState } from "./pulls";

describe("normaliseBitbucketState", () => {
  it("passes through the states every provider has", () => {
    expect(normaliseBitbucketState("OPEN")).toBe("OPEN");
    expect(normaliseBitbucketState("MERGED")).toBe("MERGED");
  });

  it("collapses Bitbucket's two abandoned states into CLOSED", () => {
    expect(normaliseBitbucketState("DECLINED")).toBe("CLOSED");
    expect(normaliseBitbucketState("SUPERSEDED")).toBe("CLOSED");
  });

  it("treats an unrecognised state as CLOSED rather than counting it as activity", () => {
    // Miscounting abandoned work as output is the worse failure, so unknown
    // states fall to the excluded side of the line.
    expect(normaliseBitbucketState("WHATEVER")).toBe("CLOSED");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/bitbucket/pulls.test.ts`
Expected: FAIL — `normaliseBitbucketState` is not exported.

- [ ] **Step 3: Narrow the state union**

In `src/types/index.ts`:

```ts
// Provider-neutral. Bitbucket's DECLINED and SUPERSEDED both map to CLOSED —
// they were already treated identically (both excluded from every tab).
export type PullRequestState = "OPEN" | "MERGED" | "CLOSED";
```

- [ ] **Step 4: Add the mapping and use it**

In `src/lib/bitbucket/pulls.ts`, add:

```ts
export const normaliseBitbucketState = (raw: string): PullRequestState =>
  raw === "OPEN" || raw === "MERGED" ? raw : "CLOSED";
```

In `fetchPullRequestsUpdatedSince`, replace `state: p.state as PullRequestState` with `state: normaliseBitbucketState(p.state)`. Deleting that `as` cast is the point of the change — it was the only thing letting Bitbucket vocabulary into the domain unchecked.

- [ ] **Step 5: Find and fix any remaining literals**

Run: `grep -rn "DECLINED\|SUPERSEDED" src/`
Expected: matches only in `src/lib/bitbucket/pulls.ts`, `src/lib/bitbucket/pulls.test.ts`, and comments. If a test fixture in `sync.test.ts` or an analytics test uses `"DECLINED"` as an input *to the domain* (rather than as raw Bitbucket input), change it to `"CLOSED"`. Comments in `scope.ts` explaining that declined work is excluded should be reworded to say `CLOSED`.

- [ ] **Step 6: Bump the schema version**

In `src/lib/db/schema.ts`: `export const SCHEMA_VERSION = 2;`

Stored rows may hold the string `'DECLINED'`, which is no longer a domain value — the bump discards them.

- [ ] **Step 7: Full verification**

Run: `npm test && npx tsc --noEmit`
Expected: 76 tests pass, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/types src/lib
git commit -m "refactor: normalise PR state to OPEN/MERGED/CLOSED

SUPERSEDED is Bitbucket-only, and DECLINED/SUPERSEDED were already treated
identically, so collapsing them changes no output while removing the last
unchecked cast from provider vocabulary into the domain."
```

---

### Task 4: Replace `readyIsFallback` with a `Precision` scale

A boolean cannot express the difference between "the provider told us exactly", "we derived it from an event feed", and "we guessed". GitHub would report merge times exactly; Bitbucket derives them. The UI needs to know which.

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/bitbucket/pulls.ts` (`deriveReadyForReview`, the fetch mapper)
- Modify: `src/lib/bitbucket/pulls.test.ts`
- Modify: `src/lib/sync/sync.ts`, `src/lib/sync/sync.test.ts`
- Modify: `src/lib/db/queries.ts` (column + mapping), `src/lib/db/schema.ts` (column + version 3), `src/lib/db/queries.test.ts`
- Modify: `src/lib/analytics/leaderboard.ts`, `src/lib/analytics/leaderboard.test.ts`
- Modify: `src/components/LeaderboardTab.tsx`

**Interfaces:**
- Consumes: `SCHEMA_VERSION` from Task 2.
- Produces:
  - `type Precision = "exact" | "derived" | "fallback"`
  - `PullRequestRecord.readyForReviewPrecision: Precision` (replaces `readyIsFallback: boolean`)
  - `PullRequestRecord.mergedOnPrecision: Precision`
  - `LeaderboardPR.readyForReviewPrecision: Precision` (replaces `readyIsFallback`)
  - `deriveReadyForReview(createdOn, activity)` now returns `{ readyForReviewOn: string; readyForReviewPrecision: Precision }`

Mapping from the old boolean: `false` → `"derived"`, `true` → `"fallback"`. Bitbucket always sets `mergedOnPrecision: "derived"` because it uses `updated_on` as a merge proxy.

- [ ] **Step 1: Write the failing tests**

In `src/lib/bitbucket/pulls.test.ts`, update the `deriveReadyForReview` tests to assert the new shape:

```ts
describe("deriveReadyForReview", () => {
  it("uses the earliest draft->ready transition and calls it derived", () => {
    const activity = [
      { update: { date: "2026-03-02T00:00:00Z", draft: false } },
      { update: { date: "2026-03-01T00:00:00Z", draft: false } },
    ];
    expect(deriveReadyForReview("2026-02-01T00:00:00Z", activity)).toEqual({
      readyForReviewOn: "2026-03-01T00:00:00Z",
      readyForReviewPrecision: "derived",
    });
  });

  it("falls back to creation time and says so", () => {
    expect(deriveReadyForReview("2026-02-01T00:00:00Z", [])).toEqual({
      readyForReviewOn: "2026-02-01T00:00:00Z",
      readyForReviewPrecision: "fallback",
    });
  });
});

describe("fetchPullRequestsUpdatedSince", () => {
  it("marks merge times derived, because Bitbucket's list has no merge timestamp", async () => {
    const fetchFn = (async () =>
      ({
        ok: true,
        json: async () => ({
          values: [
            {
              id: 7, title: "Add login", state: "MERGED",
              created_on: "2026-01-01T00:00:00Z", updated_on: "2026-01-02T00:00:00Z",
              author: { account_id: "ada" }, destination: { branch: { name: "main" } },
              links: { html: { href: "https://example.test/web/7" } }, participants: [],
            },
          ],
        }),
      }) as unknown as Response) as unknown as typeof fetch;

    const result = await fetchPullRequestsUpdatedSince(
      "acme", "web", "2026-01-01T00:00:00Z", "auth", fetchFn,
    );

    expect(result).toHaveLength(1);
    // updated_on stands in for a merge timestamp the list endpoint does not have.
    expect(result[0].mergedOn).toBe("2026-01-02T00:00:00Z");
    expect(result[0].mergedOnPrecision).toBe("derived");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/bitbucket/pulls.test.ts`
Expected: FAIL — returned objects still have `readyIsFallback`.

- [ ] **Step 3: Add `Precision` to the domain**

In `src/types/index.ts`:

```ts
// How much to trust a timestamp.
//   exact    — the provider reported this moment directly
//   derived  — computed from provider events (e.g. the earliest draft->ready update)
//   fallback — unavailable, so a weaker stand-in was used (e.g. creation time)
export type Precision = "exact" | "derived" | "fallback";
```

In `PullRequestRecord`, replace `readyIsFallback: boolean` with:

```ts
  readyForReviewOn: string;                  // ISO; equals createdOn when precision is "fallback"
  readyForReviewPrecision: Precision;
  mergedOn: string | null;                   // ISO or null
  mergedOnPrecision: Precision;
```

In `LeaderboardPR`, replace `readyIsFallback: boolean` with `readyForReviewPrecision: Precision`.

- [ ] **Step 4: Update the Bitbucket mapper**

In `src/lib/bitbucket/pulls.ts`:

```ts
export const deriveReadyForReview = (
  createdOn: string,
  activity: RawActivity[],
): { readyForReviewOn: string; readyForReviewPrecision: Precision } => {
  const readyDates = activity
    .filter((a) => a.update && a.update.draft === false)
    .map((a) => a.update!.date)
    .sort();
  if (readyDates.length > 0) {
    return { readyForReviewOn: readyDates[0], readyForReviewPrecision: "derived" };
  }
  return { readyForReviewOn: createdOn, readyForReviewPrecision: "fallback" };
};
```

Update `PullRequestPartial` to omit the new field names, and in the `raw.map(...)` add `mergedOnPrecision: "derived" as const` — Bitbucket's PR list exposes no merge timestamp, so `updated_on` stands in.

- [ ] **Step 5: Update sync**

In `src/lib/sync/sync.ts`, the `"fast"` branch becomes:

```ts
      const pr: PullRequestRecord = {
        ...prFields,
        readyForReviewOn: prFields.createdOn,
        readyForReviewPrecision: "fallback",
      };
```

and the deep branch destructures `{ readyForReviewOn, readyForReviewPrecision }` from `deriveReadyForReview`.

- [ ] **Step 6: Update storage**

In `src/lib/db/schema.ts`, in `pull_requests`, replace `ready_is_fallback INTEGER NOT NULL DEFAULT 1` with:

```sql
  ready_for_review_precision TEXT NOT NULL DEFAULT 'fallback',
  merged_on_precision        TEXT NOT NULL DEFAULT 'derived',
```

and set `export const SCHEMA_VERSION = 3;`

In `src/lib/db/queries.ts`, `upsertPullRequest` currently protects a derived ready time from being overwritten by a later fast sync, using `ready_is_fallback = 0` as the test. Preserve that behaviour with the new column — a `'derived'` or `'exact'` value must never be replaced by `'fallback'`:

```sql
       ready_for_review_on = CASE
         WHEN excluded.ready_for_review_precision <> 'fallback' THEN excluded.ready_for_review_on
         WHEN pull_requests.ready_for_review_precision <> 'fallback' THEN pull_requests.ready_for_review_on
         ELSE excluded.ready_for_review_on END,
       ready_for_review_precision = CASE
         WHEN excluded.ready_for_review_precision <> 'fallback' THEN excluded.ready_for_review_precision
         ELSE pull_requests.ready_for_review_precision END,
       merged_on_precision = excluded.merged_on_precision,
```

Drop the `readyIsFallback: pr.readyIsFallback ? 1 : 0` conversion in the `.run(...)` call — the precision values are plain strings, so `.run(pr)` works directly. Update `PrRow`, the `SELECT` column list, and the row mapper in `getPullRequests` to carry both new columns.

- [ ] **Step 7: Update the leaderboard and its UI**

In `src/lib/analytics/leaderboard.ts`, the `LeaderboardPR` construction takes `readyForReviewPrecision: pr.readyForReviewPrecision` instead of `readyIsFallback`.

In `src/components/LeaderboardTab.tsx`:
- `fallbackPrs` becomes `rows.reduce((n, r) => n + r.prs.filter((p) => p.readyForReviewPrecision === "fallback").length, 0)`
- the `*` marker becomes `{pr.readyForReviewPrecision === "fallback" ? " *" : ""}`

Leave the wording alone — Task 13 replaces it with capability-driven copy.

- [ ] **Step 8: Sweep for stragglers**

Run: `grep -rn "readyIsFallback" src/`
Expected: no matches.

- [ ] **Step 9: Full verification**

Run: `npm test && npx tsc --noEmit`
Expected: 76+ tests pass (the new mapper test adds one), no type errors.

- [ ] **Step 10: Commit**

```bash
git add src/types src/lib src/components
git commit -m "refactor: replace readyIsFallback boolean with a Precision scale

A boolean cannot distinguish 'the provider told us exactly' from 'we derived
this from an event feed' from 'we guessed'. Bitbucket derives merge times from
updated_on; a provider with real merge timestamps would report exact. The UI
needs that difference to describe honestly what it measured."
```

---

### Task 5: Rename the domain model to provider-neutral names

Purely mechanical, but touches nearly every file. Do it in one commit so no intermediate state is half-renamed.

**Files:** every file under `src/` that references the record types. Enumerate with `grep -rln "PullRequestRecord\|UserRecord\|RepoRecord\|ApprovalRecord\|accountId\|repoSlug\|mainBranch\|projectKey" src/`

**Interfaces:**
- Consumes: `Precision` and `PullRequestState` from Tasks 3–4.
- Produces the renamed domain, which every later task depends on:

| Old | New |
|---|---|
| `PullRequestRecord` | `PullRequest` |
| `PullRequest.id` | `PullRequest.number` |
| `.repoSlug` | `.repositoryId` |
| `.authorAccountId` | `.authorId` |
| `ApprovalRecord` | `Approval` |
| `Approval.prId` | `Approval.pullRequestNumber` |
| `.approverAccountId` | `.approverId` |
| `UserRecord` | `Person` |
| `Person.accountId` | `Person.id` |
| `RepoRecord` | `Repository` |
| `Repository.slug` | `Repository.id` |
| `.projectKey` | `.group` |
| `.mainBranch` | `.defaultBranch` |
| `LeaderboardRow.accountId` | `LeaderboardRow.personId` |
| `Matrix.rowUsers` | `Matrix.rowHeaders` (entries `{ key, label }`, matching `colHeaders`) |
| `PrScope.mainBranchBySlug` | `PrScope.defaultBranchByRepositoryId` |
| `PrScope.includedRepos` | `PrScope.includedRepositoryIds` |

Storage functions rename with the types they carry. Later tasks call these names, so they are part of this task's contract:

| Old | New |
|---|---|
| `upsertUsers` | `upsertPeople` |
| `upsertRepos` | `upsertRepositories` |
| `getUsers` | `getPeople` |
| `getRepos` | `getRepositories` |
| `setUserIncluded` | `setPersonIncluded` |
| `setRepoIncluded` | `setRepositoryIncluded` |

SQLite columns rename to match: `repo_slug` → `repository_id`, `id` → `number`, `author_account_id` → `author_id`, `pr_id` → `pull_request_number`, `approver_account_id` → `approver_id`, `account_id` → `id`, `slug` → `id`, `project_key` → `group_key`, `main_branch` → `default_branch`. (`group` is a SQL reserved word, hence `group_key` in the column and `group` in the type.)

`Matrix.rowUsers` → `rowHeaders` matters more than it looks: `MatrixTable` currently detects the approvals diagonal by comparing `colHeader.key` to `rowUser.accountId`. Making both axes the same `{ key, label }` shape is what lets Task 13 replace that inference with an explicit prop.

- [ ] **Step 1: Rename the types**

In `src/types/index.ts`, apply every rename in the table above. The file is 78 lines; rewrite it wholesale rather than patching.

- [ ] **Step 2: Bump the schema version and rename the columns**

In `src/lib/db/schema.ts`, apply the column renames above and set `export const SCHEMA_VERSION = 4;`

- [ ] **Step 3: Propagate through storage**

In `src/lib/db/queries.ts`, update every SQL statement, every `Row` type, and every row mapper. The `ORDER BY display_name COLLATE NOCASE` clauses and the `ON CONFLICT ... DO NOTHING` / `DO UPDATE` behaviour must be preserved exactly — the `COLLATE NOCASE` in particular is load-bearing (SQLite's default collation sorts all uppercase before lowercase, scattering lowercase usernames below every capitalised name).

- [ ] **Step 4: Propagate through the rest of `src/`**

Work through: `src/lib/bitbucket/{pulls,discover}.ts`, `src/lib/sync/sync.ts`, `src/lib/analytics/{scope,duration,leaderboard,matrices}.ts`, `src/app/api/*/route.ts`, `src/components/{MatrixTable,LeaderboardTab,TeamTab}.tsx`, `src/app/page.tsx`, and every `*.test.ts(x)`.

- [ ] **Step 5: Verify no old name survives**

Run:

```bash
grep -rn "PullRequestRecord\|UserRecord\|RepoRecord\|ApprovalRecord" src/
grep -rn "accountId\|repoSlug\|mainBranchBySlug\|rowUsers" src/
grep -rn "authorAccountId\|approverAccountId\|prId\b" src/
```

Expected: no matches from any of the three. `account_id` may legitimately remain inside `src/lib/bitbucket/` — that is Bitbucket's own wire format, which is exactly where it belongs.

- [ ] **Step 6: Full verification**

Run: `npm test && npx tsc --noEmit`
Expected: same test count as Task 4, all passing, no type errors. **A changed count means a test was lost in the rename — investigate before committing.**

- [ ] **Step 7: Commit**

```bash
git add src/
git commit -m "refactor: rename the domain model to provider-neutral names

accountId, repoSlug, projectKey and mainBranch are Bitbucket's words, and
they reached all the way into the analytics and the React components. The
domain now speaks in personId, repositoryId, group and defaultBranch.

Matrix.rowUsers becomes rowHeaders with the same {key,label} shape as
colHeaders, so the approvals diagonal can become an explicit prop instead
of something MatrixTable infers."
```

---

### Task 6: Configurable analysis window

**Files:**
- Modify: `src/lib/window.ts`, `src/lib/window.test.ts`
- Modify: `src/app/api/insights/route.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/lib/sync/sync.ts`, `src/lib/sync/sync.test.ts`

**Interfaces:**
- Consumes: `AppConfig.windowMonths` from Task 1.
- Produces:
  - `type AnalysisWindow = "recent" | "all"` (replaces `InsightsWindow = "6m" | "all"`)
  - `monthsAgoIso(nowIso: string, months: number): string` (replaces `sixMonthsAgoIso`)
  - `isAnalysisWindow(value: unknown): value is AnalysisWindow`
  - `resolveSinceIso(window: AnalysisWindow, nowIso: string, earliestIso: string | null, months: number): string`
  - `formatWindowLabel(sinceIso, untilIso)` — unchanged
  - `syncRepo` / `syncAll` gain a `backfillMonths` field on `SyncDeps`
  - API query param changes: `?window=6m` → `?window=recent`

- [ ] **Step 1: Write the failing tests**

Update `src/lib/window.test.ts` — replace the `sixMonthsAgoIso` describe block with:

```ts
describe("monthsAgoIso", () => {
  it("subtracts whole months in UTC", () => {
    expect(monthsAgoIso("2026-07-28T12:00:00.000Z", 6)).toBe("2026-01-28T12:00:00.000Z");
    expect(monthsAgoIso("2026-07-28T12:00:00.000Z", 3)).toBe("2026-04-28T12:00:00.000Z");
  });

  it("crosses a year boundary", () => {
    expect(monthsAgoIso("2026-02-15T00:00:00.000Z", 3)).toBe("2025-11-15T00:00:00.000Z");
  });
});

describe("resolveSinceIso", () => {
  it("uses the configured window for 'recent'", () => {
    expect(resolveSinceIso("recent", "2026-07-28T00:00:00.000Z", null, 3))
      .toBe("2026-04-28T00:00:00.000Z");
  });

  it("reaches back to the earliest cached PR for 'all'", () => {
    expect(resolveSinceIso("all", "2026-07-28T00:00:00.000Z", "2024-01-01T00:00:00.000Z", 6))
      .toBe("2024-01-01T00:00:00.000Z");
  });

  it("falls back to the epoch for 'all' with an empty cache", () => {
    expect(resolveSinceIso("all", "2026-07-28T00:00:00.000Z", null, 6))
      .toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("isAnalysisWindow", () => {
  it("accepts the two window keys and nothing else", () => {
    expect(isAnalysisWindow("recent")).toBe(true);
    expect(isAnalysisWindow("all")).toBe(true);
    expect(isAnalysisWindow("6m")).toBe(false);
    expect(isAnalysisWindow(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/window.test.ts`
Expected: FAIL — `monthsAgoIso` and `isAnalysisWindow` are not exported.

- [ ] **Step 3: Generalise the window module**

In `src/lib/window.ts`, replace `sixMonthsAgoIso`, `InsightsWindow`, `isInsightsWindow`, and `resolveSinceIso`:

```ts
// Returns the ISO timestamp `months` before `nowIso`.
// Pure: the caller supplies the reference instant so the result is testable.
export const monthsAgoIso = (nowIso: string, months: number): string => {
  const d = new Date(nowIso);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString();
};

// "recent" rather than "6m": the length is configurable, so naming the key after
// six months would go stale the moment someone changed it.
export type AnalysisWindow = "recent" | "all";

const EPOCH_ISO = "1970-01-01T00:00:00.000Z";

export const isAnalysisWindow = (value: unknown): value is AnalysisWindow =>
  value === "recent" || value === "all";

// Start of the analysis window. "all" reaches back to the oldest cached PR, so the
// displayed range describes real data rather than the epoch; the cache is never pruned,
// so "all" means everything ever synced, not everything that exists at the provider.
export const resolveSinceIso = (
  window: AnalysisWindow,
  nowIso: string,
  earliestIso: string | null,
  months: number,
): string => (window === "recent" ? monthsAgoIso(nowIso, months) : earliestIso ?? EPOCH_ISO);
```

Keep `formatWindowLabel` exactly as it is.

- [ ] **Step 4: Thread the window through sync**

In `src/lib/sync/sync.ts`, add `backfillMonths: number` to `SyncDeps` and replace `sixMonthsAgoIso(nowIso)` with `monthsAgoIso(nowIso, deps.backfillMonths)`. Update `sync.test.ts` fixtures to pass `backfillMonths: 6`.

- [ ] **Step 5: Update the insights route**

In `src/app/api/insights/route.ts`: rename the imports, change the validation error to `"Expected window=recent|all"`, default to `"recent"`, and pass `config.windowMonths` as the fourth argument to `resolveSinceIso`.

- [ ] **Step 6: Update the UI**

In `src/app/page.tsx`: `useState<AnalysisWindow>("recent")`, `range === "recent"` in the conditional prose, and `RangeToggle`'s options become `[{ key: "recent", label: "Last 6 months" }, { key: "all", label: "All time" }]`. Leave the hardcoded "6 months" label for now — Task 13 derives it from config.

- [ ] **Step 7: Sweep**

Run: `grep -rn "sixMonthsAgo\|InsightsWindow\|\"6m\"" src/`
Expected: no matches.

- [ ] **Step 8: Full verification**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass (count may rise by 2–3 from the new window tests), no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/
git commit -m "refactor: make the analysis window configurable

The number 6 was hardcoded in both the sync backfill and the read-time
window. ARGUS_WINDOW_MONTHS now drives both, and the window key becomes
'recent' rather than '6m' so it does not go stale when the length changes."
```

---

### Task 7: Move files into the target structure

Pure moves plus import-path updates. No logic changes — review this diff for renames only.

**Files:** see the mapping below. Use `git mv` throughout so history follows.

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces the final import paths every later task uses.

| From | To |
|---|---|
| `src/lib/window.ts` (+ test) | `src/core/window/index.ts` (+ `index.test.ts`) |
| `src/lib/analytics/*.ts` (+ tests) | `src/core/analytics/*.ts` |
| `src/types/index.ts` | split → `src/core/domain/pull-request.ts`, `src/core/domain/people.ts`, `src/core/view/insights.ts` |
| `src/lib/db/index.ts` | `src/storage/db.ts` |
| `src/lib/db/schema.ts` (+ test) | `src/storage/schema.ts` |
| `src/lib/db/queries.ts` (+ test) | `src/storage/queries/index.ts` |
| `src/lib/sync/sync.ts` (+ test) | `src/sync/sync.ts` |
| `src/lib/bitbucket/*.ts` (+ tests) | `src/providers/bitbucket/*.ts` |
| `src/components/*.tsx` (+ test) | `src/ui/*.tsx` |

Splitting `src/types/index.ts`:
- `core/domain/pull-request.ts` — `Precision`, `PullRequestState`, `PullRequest`, `Approval`
- `core/domain/people.ts` — `Person`, `Repository`
- `core/view/insights.ts` — `LeaderboardPR`, `LeaderboardRow`, `Matrix`, `InsightsResponse`

`InsightsResponse` imports `AnalysisWindow` from `@/core/window`; that is a core→core edge and allowed.

- [ ] **Step 1: Create directories and move**

```bash
mkdir -p src/core/{domain,window,analytics,view} src/storage/queries src/sync src/providers/bitbucket src/ui
git mv src/lib/window.ts src/core/window/index.ts
git mv src/lib/window.test.ts src/core/window/index.test.ts
git mv src/lib/analytics/scope.ts src/lib/analytics/duration.ts src/lib/analytics/leaderboard.ts src/lib/analytics/matrices.ts src/core/analytics/
git mv src/lib/analytics/duration.test.ts src/lib/analytics/leaderboard.test.ts src/lib/analytics/matrices.test.ts src/core/analytics/
git mv src/lib/db/index.ts src/storage/db.ts
git mv src/lib/db/schema.ts src/storage/schema.ts
git mv src/lib/db/schema.test.ts src/storage/schema.test.ts
git mv src/lib/db/queries.ts src/storage/queries/index.ts
git mv src/lib/db/queries.test.ts src/storage/queries/index.test.ts
git mv src/lib/sync/sync.ts src/lib/sync/sync.test.ts src/sync/
git mv src/lib/bitbucket/client.ts src/lib/bitbucket/client.test.ts src/providers/bitbucket/
git mv src/lib/bitbucket/discover.ts src/lib/bitbucket/discover.test.ts src/providers/bitbucket/
git mv src/lib/bitbucket/pulls.ts src/lib/bitbucket/pulls.test.ts src/providers/bitbucket/
git mv src/components/Tabs.tsx src/components/TeamTab.tsx src/components/LeaderboardTab.tsx src/ui/
git mv src/components/MatrixTable.tsx src/components/MatrixTable.test.tsx src/ui/
rmdir src/lib/analytics src/lib/db src/lib/sync src/lib/bitbucket src/lib src/components
```

- [ ] **Step 2: Split the types file**

Create the three files listed above with the contents of `src/types/index.ts` divided between them, then `git rm src/types/index.ts` and `rmdir src/types`.

- [ ] **Step 3: Update every import**

Rewrite import specifiers across `src/`:

| Old specifier | New |
|---|---|
| `@/types` | `@/core/domain/pull-request`, `@/core/domain/people`, or `@/core/view/insights` — whichever holds the symbol |
| `@/lib/window` | `@/core/window` |
| `@/lib/analytics/…` | `@/core/analytics/…` |
| `@/lib/db` | `@/storage/db` |
| `@/lib/db/queries` | `@/storage/queries` |
| `@/lib/sync/sync` | `@/sync/sync` |
| `@/lib/bitbucket/…` | `@/providers/bitbucket/…` |
| `@/components/…` | `@/ui/…` |

Relative imports inside a moved folder (e.g. `./duration` in `leaderboard.ts`, `./client` in `discover.ts`) are unaffected.

- [ ] **Step 4: Verify nothing points at the old tree**

Run: `grep -rn "@/lib/\|@/types\|@/components" src/`
Expected: no matches.

Run: `ls src/`
Expected: `app config core dashboard? providers storage sync ui` — no `lib`, `types`, or `components`. (`dashboard/` does not exist until Task 14.)

- [ ] **Step 5: Full verification**

Run: `npm test && npx tsc --noEmit`
Expected: identical test count to Task 6, all passing, no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: move files into core/providers/storage/sync/ui

Pure moves and import-path updates, no logic changes. src/types/index.ts —
a single global types file — is dissolved into core/domain (records) and
core/view (the view models analytics produce)."
```

---

### Task 8: Capabilities in core, and the provider port

**Files:**
- Create: `src/core/capabilities/index.ts`
- Create: `src/providers/provider.ts`
- Modify: `src/core/view/insights.ts` (add the `provider` field)

**Interfaces:**
- Consumes: `PullRequest`, `Approval`, `Person`, `Repository` from `core/domain`.
- Produces:
  - `ProviderCapabilities`, `ProviderInfo` in `@/core/capabilities`
  - `PullRequestProvider`, `DetailLevel`, `RepositoryRef`, `FetchedPullRequest` in `@/providers/provider`
  - `InsightsResponse.provider: ProviderInfo`

Capabilities live in **core**, not providers: `ui/` renders caveats from them and may only import from `core/`.

- [ ] **Step 1: Define capabilities in core**

Create `src/core/capabilities/index.ts`:

```ts
// What a provider is able to tell us, independent of which provider it is.
// The UI renders its caveats from this rather than hardcoding one host's
// limitations, so a provider that reports merge times exactly stops printing
// a warning that does not apply to it.
export type ProviderCapabilities = {
  // "derived" means the provider exposes no merge timestamp and a proxy is used.
  mergeTimestamps: "exact" | "derived";
  // "onDemand" means available, but only via an extra request per pull request.
  // "unavailable" implies every readyForReviewPrecision will be "fallback".
  readyForReviewTimestamps: "exact" | "onDemand" | "unavailable";
  approvalTimestamps: "exact" | "onDemand" | "unavailable";
  // Whether an incremental fetch can be expressed as "updated since T".
  incrementalByUpdatedAt: boolean;
};

// The provider, as the UI is allowed to know it: a label and what it can do.
// Deliberately not the provider's own id in any behavioural sense — the UI must
// branch on capabilities, never on which host this is.
export type ProviderInfo = {
  id: string;
  label: string;
  capabilities: ProviderCapabilities;
};
```

- [ ] **Step 2: Define the port**

Create `src/providers/provider.ts`:

```ts
import type { ProviderCapabilities } from "@/core/capabilities";
import type { Approval, PullRequest } from "@/core/domain/pull-request";
import type { Person, Repository } from "@/core/domain/people";

// How hard to work for a single repository's pull requests.
//   "summary" — list endpoints only; cheap, roughly one request per page of PRs
//   "full"    — whatever extra requests the provider needs for exact timestamps
// The caller states intent; the adapter decides what that costs. Sync must not
// know that Bitbucket satisfies "full" with one activity call per PR.
export type DetailLevel = "summary" | "full";

export type RepositoryRef = { id: string; defaultBranch: string };

export type FetchedPullRequest = {
  pullRequest: PullRequest;
  approvals: Approval[];
  // true  — this is the complete approval history; storage should replace.
  // false — this is only what the summary endpoint exposed, so it cannot show
  //         withdrawn approvals; storage should merge and keep what it has.
  approvalsAreComplete: boolean;
};

export type PullRequestProvider = {
  readonly id: string;
  readonly label: string;
  readonly capabilities: ProviderCapabilities;
  listPeople(): Promise<Person[]>;
  listRepositories(): Promise<Repository[]>;
  // Returns every pull request updated at or after `updatedSince`, in every
  // state. Filtering by state, branch, or roster is the caller's job: a PR
  // cached while OPEN must still be re-fetched once it is closed, or it would
  // count as in-flight forever.
  listPullRequests(
    repo: RepositoryRef,
    updatedSince: string,
    detail: DetailLevel,
  ): Promise<FetchedPullRequest[]>;
};
```

- [ ] **Step 3: Add the provider block to the insights view model**

In `src/core/view/insights.ts`, add `import type { ProviderInfo } from "@/core/capabilities";` and a `provider: ProviderInfo;` field to `InsightsResponse`.

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: one error — `src/app/api/insights/route.ts` no longer satisfies `InsightsResponse` because `provider` is missing. That is expected and fixed in Task 12. To keep this task green, add the field now in the route using a temporary literal:

```ts
      provider: { id: "bitbucket", label: "Bitbucket", capabilities: {
        mergeTimestamps: "derived", readyForReviewTimestamps: "onDemand",
        approvalTimestamps: "onDemand", incrementalByUpdatedAt: true,
      } },
```

Task 12 replaces this literal with the real provider's own declaration. Leave a `// TEMPORARY: replaced in Task 12` comment on it so it cannot be forgotten.

- [ ] **Step 5: Full verification**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/core src/providers src/app
git commit -m "feat: add provider capabilities and the PullRequestProvider port

Capabilities live in core, not providers, because the UI renders its caveats
from them and may only import from core.

DetailLevel replaces the fast/deep sync modes: the caller states intent and
the adapter decides the cost. approvalsAreComplete carries the existing
merge-vs-replace approval distinction across the abstraction."
```

---

### Task 9: Bitbucket adapter implements the port

**Files:**
- Create: `src/providers/bitbucket/map.ts`, `src/providers/bitbucket/map.test.ts`
- Create: `src/providers/bitbucket/index.ts`
- Create: `src/providers/registry.ts`
- Modify: `src/providers/bitbucket/client.ts` (auth from config, not `process.env`)

**Interfaces:**
- Consumes: the port from Task 8; `BitbucketConfig` from Task 1.
- Produces:
  - `createBitbucketProvider(cfg: BitbucketConfig, fetchFn?: typeof fetch): PullRequestProvider`
  - `BITBUCKET_CAPABILITIES: ProviderCapabilities`
  - `basicAuthHeader(email: string, apiToken: string): string` in `client.ts` (replaces `getAuthHeader()`)
  - `createProvider(app: AppConfig, env: Record<string, string | undefined>): PullRequestProvider` in `registry.ts`

- [ ] **Step 1: Write the failing test**

Create `src/providers/bitbucket/map.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BITBUCKET_CAPABILITIES } from "./index";
import { toRepository, toPerson } from "./map";

describe("BITBUCKET_CAPABILITIES", () => {
  it("declares merge times derived, because the PR list has no merge timestamp", () => {
    expect(BITBUCKET_CAPABILITIES.mergeTimestamps).toBe("derived");
  });

  it("declares ready-for-review and approval times as on-demand", () => {
    // Both need one /activity request per PR — that is what "full" detail buys.
    expect(BITBUCKET_CAPABILITIES.readyForReviewTimestamps).toBe("onDemand");
    expect(BITBUCKET_CAPABILITIES.approvalTimestamps).toBe("onDemand");
  });

  it("supports incremental fetching by updated_on", () => {
    expect(BITBUCKET_CAPABILITIES.incrementalByUpdatedAt).toBe(true);
  });
});

describe("toRepository", () => {
  it("maps slug, project key and mainbranch onto the neutral names", () => {
    expect(toRepository({
      slug: "web", name: "Web", project: { key: "PROJ" }, mainbranch: { name: "trunk" },
    })).toEqual({ id: "web", name: "Web", group: "PROJ", defaultBranch: "trunk", included: false });
  });

  it("defaults a missing mainbranch to main and a missing project to null", () => {
    expect(toRepository({ slug: "web", name: "Web" }))
      .toEqual({ id: "web", name: "Web", group: null, defaultBranch: "main", included: false });
  });
});

describe("toPerson", () => {
  it("maps account_id and display_name onto the neutral names", () => {
    expect(toPerson({ user: { account_id: "abc", display_name: "Ada" } }))
      .toEqual({ id: "abc", displayName: "Ada", included: false });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/providers/bitbucket/map.test.ts`
Expected: FAIL — `./map` and `./index` do not exist.

- [ ] **Step 3: Extract the mapping functions**

Create `src/providers/bitbucket/map.ts`. Move the raw wire types (`MemberValue`, `RepoValue`, `RawPr`, `RawActivity`, `RawParticipant`) here from `discover.ts` / `pulls.ts`, along with `normaliseBitbucketState`, and add:

```ts
import type { Person, Repository } from "@/core/domain/people";

export type MemberValue = { user: { account_id: string; display_name: string } };
export type RepoValue = {
  slug: string;
  name: string;
  project?: { key: string };
  mainbranch?: { name: string };
};

// Discovery adds everything it finds as excluded: a workspace can hold hundreds
// of repos, and only ticked ones are ever fetched.
export const toPerson = (v: MemberValue): Person => ({
  id: v.user.account_id,
  displayName: v.user.display_name,
  included: false,
});

export const toRepository = (v: RepoValue): Repository => ({
  id: v.slug,
  name: v.name,
  group: v.project?.key ?? null,
  defaultBranch: v.mainbranch?.name ?? "main",
  included: false,
});
```

Keep `discover.ts` and `pulls.ts` as the request/paging layer, now importing their mappers from `map.ts`.

- [ ] **Step 4: Take auth from config instead of the environment**

In `src/providers/bitbucket/client.ts`, replace `getAuthHeader()`:

```ts
export const basicAuthHeader = (email: string, apiToken: string): string =>
  `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
```

The missing-variable check moves to `readBitbucketConfig` (Task 1), which already reports every missing name at once.

- [ ] **Step 5: Implement the port**

Create `src/providers/bitbucket/index.ts`:

```ts
import type { BitbucketConfig } from "@/config";
import type { ProviderCapabilities } from "@/core/capabilities";
import type {
  DetailLevel, FetchedPullRequest, PullRequestProvider, RepositoryRef,
} from "@/providers/provider";
import { basicAuthHeader, type FetchFn } from "./client";
import { fetchRepos, fetchWorkspaceMembers } from "./discover";
import {
  deriveReadyForReview, extractApprovals, extractApprovalsFromParticipants,
  fetchPullRequestActivity, fetchPullRequestsUpdatedSince,
} from "./pulls";

// Bitbucket's PR list exposes no merge timestamp, so mergedOn is the last-touched
// proxy — derived, not exact. Ready-for-review and approval times exist only in
// the per-PR activity feed, which is one extra request each: onDemand.
export const BITBUCKET_CAPABILITIES: ProviderCapabilities = {
  mergeTimestamps: "derived",
  readyForReviewTimestamps: "onDemand",
  approvalTimestamps: "onDemand",
  incrementalByUpdatedAt: true,
};

export const createBitbucketProvider = (
  cfg: BitbucketConfig,
  fetchFn: FetchFn = globalThis.fetch,
): PullRequestProvider => {
  const auth = basicAuthHeader(cfg.email, cfg.apiToken);

  return {
    id: "bitbucket",
    label: "Bitbucket Cloud",
    capabilities: BITBUCKET_CAPABILITIES,

    listPeople: () => fetchWorkspaceMembers(cfg.workspace, auth, fetchFn),
    listRepositories: () => fetchRepos(cfg.workspace, cfg.projectKey, auth, fetchFn),

    listPullRequests: async (
      repo: RepositoryRef,
      updatedSince: string,
      detail: DetailLevel,
    ): Promise<FetchedPullRequest[]> => {
      const partials = await fetchPullRequestsUpdatedSince(
        cfg.workspace, repo.id, updatedSince, auth, fetchFn,
      );

      if (detail === "summary") {
        // participants[] gives current approvals with no timestamps, and cannot
        // show approvals that were withdrawn — hence approvalsAreComplete: false.
        return partials.map(({ approvals, ...pr }) => ({
          pullRequest: {
            ...pr,
            readyForReviewOn: pr.createdOn,
            readyForReviewPrecision: "fallback" as const,
          },
          approvals,
          approvalsAreComplete: false,
        }));
      }

      const out: FetchedPullRequest[] = [];
      for (const { approvals: _participantApprovals, ...pr } of partials) {
        const activity = await fetchPullRequestActivity(
          cfg.workspace, repo.id, pr.number, auth, fetchFn,
        );
        const ready = deriveReadyForReview(pr.createdOn, activity);
        out.push({
          pullRequest: { ...pr, ...ready },
          approvals: extractApprovals(repo.id, pr.number, activity),
          approvalsAreComplete: true,
        });
      }
      return out;
    },
  };
};
```

- [ ] **Step 6: Add the registry**

Create `src/providers/registry.ts`:

```ts
import { readBitbucketConfig, type AppConfig } from "@/config";
import { createFixtureProvider } from "@/providers/fixture";
import { createBitbucketProvider } from "@/providers/bitbucket";
import type { PullRequestProvider } from "@/providers/provider";

type Env = Record<string, string | undefined>;

// Each factory reads only its own provider's configuration, so an unused
// provider's missing variables never block startup.
const FACTORIES: Record<string, (env: Env) => PullRequestProvider> = {
  bitbucket: (env) => createBitbucketProvider(readBitbucketConfig(env)),
  fixture: () => createFixtureProvider(),
};

export const createProvider = (app: AppConfig, env: Env): PullRequestProvider => {
  const factory = FACTORIES[app.providerName];
  if (!factory) {
    throw new Error(
      `Unknown ARGUS_PROVIDER "${app.providerName}". Available: ${Object.keys(FACTORIES).join(", ")}`,
    );
  }
  return factory(env);
};
```

This imports `@/providers/fixture`, created in Task 10 — so `tsc` will fail until then. Create `src/providers/fixture/index.ts` with a single-line stub now and fill it in Task 10:

```ts
import type { PullRequestProvider } from "@/providers/provider";
export const createFixtureProvider = (): PullRequestProvider => {
  throw new Error("not implemented yet — Task 10");
};
```

- [ ] **Step 7: Update the two routes that used `getAuthHeader`**

In `src/app/api/discover/route.ts` and `src/app/api/sync/route.ts`, replace `getAuthHeader()` and the direct `fetch*` calls with `createProvider(config, process.env)`. Discover becomes:

```ts
    const provider = createProvider(config, process.env);
    const [people, repos] = await Promise.all([
      provider.listPeople(), provider.listRepositories(),
    ]);
    const db = getDb(config.dbPath);
    upsertPeople(db, people);
    upsertRepositories(db, repos);
    return NextResponse.json({ users: people.length, repos: repos.length });
```

(Keep the JSON response keys `users` / `repos` — `TeamTab` reads them, and Task 14 owns that component.)

`sync/route.ts` cannot be finished until Task 11 changes `SyncDeps`; for now pass the provider through and leave the existing `fetchPRs` / `fetchActivity` fields in place so the file still compiles.

- [ ] **Step 8: Run the map tests**

Run: `npx vitest run src/providers/bitbucket/map.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 9: Full verification**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 10: Commit**

```bash
git add src/providers src/app src/config
git commit -m "feat: implement the port with a Bitbucket adapter and registry

Bitbucket's wire vocabulary is now confined to providers/bitbucket: map.ts
translates account_id, slug, project.key and mainbranch into the domain, and
index.ts declares what Bitbucket can and cannot tell us.

Auth moves from reading process.env directly to taking config, so the adapter
is constructible in a test."
```

---

### Task 10: Fixture provider and the contract suite

The fixture is the second implementation that keeps the port honest, and the test double that replaces `sync.test.ts`'s hand-rolled fakes.

**Files:**
- Modify: `src/providers/fixture/index.ts` (replace the Task 9 stub)
- Create: `src/providers/provider-contract.ts`
- Create: `src/providers/fixture/index.test.ts`

**Interfaces:**
- Consumes: the port from Task 8.
- Produces:
  - `createFixtureProvider(seed?: FixtureSeed): PullRequestProvider`
  - `type FixtureSeed = { people?: Person[]; repositories?: Repository[]; pullRequests?: FetchedPullRequest[] }`
  - `describeProviderContract(name: string, factory: () => PullRequestProvider): void`

- [ ] **Step 1: Write the contract suite**

Create `src/providers/provider-contract.ts`. It imports from `vitest` despite not being a `.test.ts` file — it is a test kit, only ever imported by tests, and Task 15's boundary test lists it as an explicit exception.

```ts
import { describe, expect, it } from "vitest";
import type { PullRequestProvider } from "@/providers/provider";

const EPOCH = "1970-01-01T00:00:00.000Z";

// Every provider must satisfy this. Run it against each adapter; it is what
// makes adding a new provider a bounded job rather than a guess.
export const describeProviderContract = (
  name: string,
  factory: () => PullRequestProvider,
): void => {
  describe(`${name} satisfies the provider contract`, () => {
    it("exposes a non-empty id and label", () => {
      const p = factory();
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
    });

    it("lists people with unique, non-empty ids", async () => {
      const people = await factory().listPeople();
      const ids = people.map((x) => x.id);
      expect(ids.every(Boolean)).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("lists repositories with a default branch and unique ids", async () => {
      const repos = await factory().listRepositories();
      expect(repos.every((r) => Boolean(r.defaultBranch))).toBe(true);
      const ids = repos.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("discovers people and repositories as excluded", async () => {
      // A workspace can hold hundreds of repos; opting in is the user's choice.
      const p = factory();
      const [people, repos] = await Promise.all([p.listPeople(), p.listRepositories()]);
      expect(people.every((x) => x.included === false)).toBe(true);
      expect(repos.every((r) => r.included === false)).toBe(true);
    });

    it("returns only normalised pull request states", async () => {
      const p = factory();
      const repos = await p.listRepositories();
      for (const repo of repos) {
        const fetched = await p.listPullRequests(repo, EPOCH, "summary");
        for (const f of fetched) {
          expect(["OPEN", "MERGED", "CLOSED"]).toContain(f.pullRequest.state);
        }
      }
    });

    it("gives every merged pull request a mergedOn, and every unmerged one none", async () => {
      const p = factory();
      const repos = await p.listRepositories();
      for (const repo of repos) {
        for (const f of await p.listPullRequests(repo, EPOCH, "summary")) {
          const { state, mergedOn } = f.pullRequest;
          if (state === "MERGED") expect(mergedOn).toBeTruthy();
          else expect(mergedOn).toBeNull();
        }
      }
    });

    it("never claims a summary fetch's approvals are complete", async () => {
      // A list endpoint cannot show withdrawn approvals, so it must not tell
      // storage to replace what a full fetch previously recorded.
      const p = factory();
      const repos = await p.listRepositories();
      for (const repo of repos) {
        for (const f of await p.listPullRequests(repo, EPOCH, "summary")) {
          expect(f.approvalsAreComplete).toBe(false);
        }
      }
    });

    it("honours updatedSince by returning no more than an epoch fetch would", async () => {
      const p = factory();
      const repos = await p.listRepositories();
      for (const repo of repos) {
        const all = await p.listPullRequests(repo, EPOCH, "summary");
        const recent = await p.listPullRequests(repo, "2999-01-01T00:00:00.000Z", "summary");
        expect(recent.length).toBeLessThanOrEqual(all.length);
      }
    });

    it("reports ready-for-review precision consistent with its capabilities", async () => {
      const p = factory();
      const repos = await p.listRepositories();
      for (const repo of repos) {
        for (const f of await p.listPullRequests(repo, EPOCH, "full")) {
          const { readyForReviewPrecision } = f.pullRequest;
          if (p.capabilities.readyForReviewTimestamps === "unavailable") {
            expect(readyForReviewPrecision).toBe("fallback");
          } else {
            expect(["exact", "derived", "fallback"]).toContain(readyForReviewPrecision);
          }
        }
      }
    });
  });
};
```

- [ ] **Step 2: Run it to verify it fails**

Create `src/providers/fixture/index.test.ts`:

```ts
import { describeProviderContract } from "@/providers/provider-contract";
import { createFixtureProvider } from "./index";

describeProviderContract("fixture provider", () => createFixtureProvider());
```

Run: `npx vitest run src/providers/fixture/index.test.ts`
Expected: FAIL — the Task 9 stub throws "not implemented yet".

- [ ] **Step 3: Implement the fixture provider**

Replace `src/providers/fixture/index.ts`:

```ts
import type { ProviderCapabilities } from "@/core/capabilities";
import type { Person, Repository } from "@/core/domain/people";
import type {
  DetailLevel, FetchedPullRequest, PullRequestProvider, RepositoryRef,
} from "@/providers/provider";

export type FixtureSeed = {
  people?: Person[];
  repositories?: Repository[];
  // Keyed by repository id.
  pullRequests?: Record<string, FetchedPullRequest[]>;
  capabilities?: Partial<ProviderCapabilities>;
  // Set to have listPullRequests reject, for exercising sync's error handling.
  failOnRepositoryIds?: string[];
};

// A provider with everything exact: no host limitations to model, so it is also
// the case that proves the UI drops caveats when a provider does not need them.
const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  mergeTimestamps: "exact",
  readyForReviewTimestamps: "exact",
  approvalTimestamps: "exact",
  incrementalByUpdatedAt: true,
};

const DEFAULT_PEOPLE: Person[] = [
  { id: "ada", displayName: "Ada Lovelace", included: false },
  { id: "grace", displayName: "Grace Hopper", included: false },
];

const DEFAULT_REPOS: Repository[] = [
  { id: "web", name: "Web", group: "PROJ", defaultBranch: "main", included: false },
];

const DEFAULT_PRS: Record<string, FetchedPullRequest[]> = {
  web: [
    {
      pullRequest: {
        number: 1, repositoryId: "web", authorId: "ada", title: "Add login",
        state: "MERGED", createdOn: "2026-01-01T00:00:00.000Z",
        readyForReviewOn: "2026-01-01T06:00:00.000Z", readyForReviewPrecision: "exact",
        mergedOn: "2026-01-02T00:00:00.000Z", mergedOnPrecision: "exact",
        destinationBranch: "main", url: "https://example.test/web/1",
      },
      approvals: [{
        repositoryId: "web", pullRequestNumber: 1,
        approverId: "grace", approvedOn: "2026-01-01T12:00:00.000Z",
      }],
      approvalsAreComplete: true,
    },
    {
      pullRequest: {
        number: 2, repositoryId: "web", authorId: "grace", title: "Fix nav",
        state: "OPEN", createdOn: "2026-02-01T00:00:00.000Z",
        readyForReviewOn: "2026-02-01T00:00:00.000Z", readyForReviewPrecision: "exact",
        mergedOn: null, mergedOnPrecision: "exact",
        destinationBranch: "main", url: "https://example.test/web/2",
      },
      approvals: [],
      approvalsAreComplete: true,
    },
  ],
};

// In-memory provider. Serves two purposes: it is the test double sync and the
// contract suite run against, and it lets the UI run with no credentials.
export const createFixtureProvider = (seed: FixtureSeed = {}): PullRequestProvider => {
  const people = seed.people ?? DEFAULT_PEOPLE;
  const repositories = seed.repositories ?? DEFAULT_REPOS;
  const prs = seed.pullRequests ?? DEFAULT_PRS;
  const failing = new Set(seed.failOnRepositoryIds ?? []);

  return {
    id: "fixture",
    label: "Fixture (in-memory)",
    capabilities: { ...DEFAULT_CAPABILITIES, ...seed.capabilities },

    listPeople: async () => people,
    listRepositories: async () => repositories,

    listPullRequests: async (
      repo: RepositoryRef,
      updatedSince: string,
      detail: DetailLevel,
    ): Promise<FetchedPullRequest[]> => {
      if (failing.has(repo.id)) {
        throw new Error(`fixture: simulated failure for repository "${repo.id}"`);
      }
      // No updated_on is modelled, so the closest honest filter is the latest
      // moment we know about each PR.
      const lastTouched = (f: FetchedPullRequest): string =>
        f.pullRequest.mergedOn ?? f.pullRequest.createdOn;

      return (prs[repo.id] ?? [])
        .filter((f) => lastTouched(f) >= updatedSince)
        .map((f) =>
          detail === "summary"
            ? { ...f, approvals: f.approvals.map((a) => ({ ...a, approvedOn: null })), approvalsAreComplete: false }
            : f,
        );
    },
  };
};
```

- [ ] **Step 4: Run the contract suite to verify it passes**

Run: `npx vitest run src/providers/fixture/index.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the contract suite against Bitbucket too**

Create `src/providers/bitbucket/contract.test.ts`:

```ts
import { describeProviderContract } from "@/providers/provider-contract";
import { createBitbucketProvider } from "./index";

// A canned fetch, so the contract runs against the real adapter without network
// access or credentials. One repo, one merged PR, one open PR.
const page = (values: unknown[]) => ({ ok: true, json: async () => ({ values }) }) as unknown as Response;

const fakeFetch = (async (url: string | URL | Request): Promise<Response> => {
  const href = String(url);
  if (href.includes("/workspaces/")) {
    return page([{ user: { account_id: "ada", display_name: "Ada Lovelace" } }]);
  }
  if (href.includes("/activity")) {
    return page([{ update: { date: "2026-01-01T06:00:00Z", draft: false } }]);
  }
  if (href.includes("/pullrequests")) {
    return page([
      {
        id: 1, title: "Add login", state: "MERGED",
        created_on: "2026-01-01T00:00:00Z", updated_on: "2026-01-02T00:00:00Z",
        author: { account_id: "ada" }, destination: { branch: { name: "main" } },
        links: { html: { href: "https://example.test/web/1" } }, participants: [],
      },
      {
        id: 2, title: "Fix nav", state: "OPEN",
        created_on: "2026-02-01T00:00:00Z", updated_on: "2026-02-01T00:00:00Z",
        author: { account_id: "ada" }, destination: { branch: { name: "main" } },
        links: { html: { href: "https://example.test/web/2" } }, participants: [],
      },
    ]);
  }
  // /repositories/{workspace}
  return page([{ slug: "web", name: "Web", project: { key: "PROJ" }, mainbranch: { name: "main" } }]);
}) as unknown as typeof fetch;

describeProviderContract("bitbucket provider", () =>
  createBitbucketProvider(
    { email: "a@b.com", apiToken: "tok", workspace: "acme", projectKey: null },
    fakeFetch,
  ),
);
```

Run: `npx vitest run src/providers/bitbucket/contract.test.ts`
Expected: PASS, 9 tests. **If the `updatedSince` test fails**, that is a genuine finding, not a test bug: Bitbucket filters server-side via the `q` parameter, so a fake that ignores `q` returns everything regardless. Relax that one assertion for Bitbucket by having `fakeFetch` honour the `q=updated_on>=` parameter — do not weaken the contract.

- [ ] **Step 6: Full verification**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass (+18 from the two contract runs), no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/providers
git commit -m "feat: add fixture provider and a shared provider contract suite

The fixture is the second implementation that keeps the port honest, the test
double sync uses instead of hand-rolled fakes, and a way to run the UI without
credentials. The contract suite runs against both adapters, so adding a third
provider is a bounded job rather than a guess."
```

---

### Task 11: Sync takes a provider

**Files:**
- Modify: `src/sync/sync.ts`, `src/sync/sync.test.ts`
- Modify: `src/storage/queries/index.ts` (add `provider_id`), `src/storage/schema.ts` (version 5)
- Modify: `src/app/api/sync/route.ts`

**Interfaces:**
- Consumes: the port (Task 8), the fixture (Task 10).
- Produces:
  - `type SyncDeps = { db: Database.Database; provider: PullRequestProvider; backfillMonths: number; detail?: DetailLevel }`
  - `syncRepository(deps, repo: RepositoryRef, nowIso): Promise<RepoSyncResult>` (renamed from `syncRepo`)
  - `type RepoSyncResult = { repositoryId: string; prCount: number }`
  - `syncAll(deps, repos: RepositoryRef[], nowIso): Promise<SyncSummary>`
  - `type SyncSummary = { repos: RepoSyncResult[]; errors: { repositoryId: string; message: string }[]; totalPrs: number }`

`SyncDeps` loses `workspace`, `auth`, `fetchPRs`, and `fetchActivity` — four Bitbucket-shaped fields replaced by one provider.

- [ ] **Step 1: Write the failing tests**

Rewrite `src/sync/sync.test.ts` around the fixture provider. Keep every existing assertion's intent; add the two new behaviours:

```ts
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "@/storage/schema";
import { createFixtureProvider } from "@/providers/fixture";
import { getPullRequests, getApprovals } from "@/storage/queries";
import { syncAll, type SyncDeps } from "./sync";

const NOW = "2026-03-01T00:00:00.000Z";

const setup = (seed = {}) => {
  const db = new Database(":memory:");
  applySchema(db);
  const provider = createFixtureProvider(seed);
  const deps: SyncDeps = { db, provider, backfillMonths: 6 };
  return { db, provider, deps };
};

const webRepo = { id: "web", defaultBranch: "main" };

describe("syncAll", () => {
  it("caches every pull request the provider returns", async () => {
    const { db, deps } = setup();
    const summary = await syncAll(deps, [webRepo], NOW);
    expect(summary.totalPrs).toBe(2);
    expect(summary.errors).toEqual([]);
    expect(getPullRequests(db, "fixture")).toHaveLength(2);
  });

  it("records which provider each row came from", async () => {
    const { db, deps } = setup();
    await syncAll(deps, [webRepo], NOW);
    const rows = db.prepare("SELECT DISTINCT provider_id FROM pull_requests").all();
    expect(rows).toEqual([{ provider_id: "fixture" }]);
  });

  it("keeps going when one repository fails, and reports it", async () => {
    // One failing repo used to abort every remaining repo and report nothing.
    const { db, deps } = setup({
      repositories: [
        { id: "web", name: "Web", group: null, defaultBranch: "main", included: true },
        { id: "bad", name: "Bad", group: null, defaultBranch: "main", included: true },
      ],
      failOnRepositoryIds: ["bad"],
    });
    const summary = await syncAll(deps, [{ id: "bad", defaultBranch: "main" }, webRepo], NOW);

    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].repositoryId).toBe("bad");
    expect(summary.repos.map((r) => r.repositoryId)).toEqual(["web"]);
    expect(getPullRequests(db, "fixture")).toHaveLength(2); // the healthy repo still landed
  });

  it("does not advance the sync watermark for a repository that failed", async () => {
    const { db, deps } = setup({
      repositories: [{ id: "bad", name: "Bad", group: null, defaultBranch: "main", included: true }],
      failOnRepositoryIds: ["bad"],
    });
    await syncAll(deps, [{ id: "bad", defaultBranch: "main" }], NOW);
    const row = db.prepare("SELECT last_synced_on FROM sync_state WHERE repository_id = 'bad'").get();
    expect(row).toBeUndefined(); // otherwise the failed window would be skipped forever
  });

  it("replaces approvals on a full fetch and merges them on a summary fetch", async () => {
    const { db, deps } = setup();
    await syncAll({ ...deps, detail: "full" }, [webRepo], NOW);
    expect(getApprovals(db, "fixture")).toHaveLength(1);
    expect(getApprovals(db, "fixture")[0].approvedOn).toBe("2026-01-01T12:00:00.000Z");

    // A later summary sync must not discard the timestamp a full sync recorded.
    await syncAll({ ...deps, detail: "summary" }, [webRepo], NOW);
    expect(getApprovals(db, "fixture")[0].approvedOn).toBe("2026-01-01T12:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/sync/sync.test.ts`
Expected: FAIL — `SyncDeps` still requires `workspace` / `auth` / `fetchPRs` / `fetchActivity`.

- [ ] **Step 3: Add `provider_id` to storage**

In `src/storage/schema.ts`, add `provider_id TEXT NOT NULL` as the first column of `pull_requests` and `approvals`, and make the primary keys `(provider_id, repository_id, number)` and `(provider_id, repository_id, pull_request_number, approver_id)`. Add `provider_id` to `sync_state`'s primary key too: `PRIMARY KEY (provider_id, repository_id)`. Set `export const SCHEMA_VERSION = 5;`

In `src/storage/queries/index.ts`, thread a `providerId: string` parameter through `upsertPullRequest`, `mergeApprovals`, `replaceApprovals`, `getLastSynced`, and `setLastSynced`, adding it to every statement's columns, `WHERE` clauses, and `ON CONFLICT` targets. `getPullRequests` and `getApprovals` take `providerId` and filter on it, so a cache holding two providers cannot mix them into one analysis.

- [ ] **Step 4: Rewrite sync**

Replace `src/sync/sync.ts`:

```ts
import type Database from "better-sqlite3";
import { monthsAgoIso } from "@/core/window";
import type { DetailLevel, PullRequestProvider, RepositoryRef } from "@/providers/provider";
import {
  getLastSynced, mergeApprovals, replaceApprovals, setLastSynced, upsertPullRequest,
} from "@/storage/queries";

export type SyncDeps = {
  db: Database.Database;
  provider: PullRequestProvider;
  backfillMonths: number;
  detail?: DetailLevel;
};

export type RepoSyncResult = { repositoryId: string; prCount: number };
export type SyncError = { repositoryId: string; message: string };
export type SyncSummary = {
  repos: RepoSyncResult[];
  errors: SyncError[];
  totalPrs: number;
};

export const syncRepository = async (
  deps: SyncDeps,
  repo: RepositoryRef,
  nowIso: string,
): Promise<RepoSyncResult> => {
  const providerId = deps.provider.id;
  const since = getLastSynced(deps.db, providerId, repo.id) ?? monthsAgoIso(nowIso, deps.backfillMonths);
  const detail = deps.detail ?? "summary";

  const fetched = await deps.provider.listPullRequests(repo, since, detail);

  for (const { pullRequest, approvals, approvalsAreComplete } of fetched) {
    upsertPullRequest(deps.db, providerId, pullRequest);
    // Complete history is authoritative and replaces; a partial list can only
    // add, or it would silently delete timestamps a full sync had recorded.
    if (approvalsAreComplete) {
      replaceApprovals(deps.db, providerId, repo.id, pullRequest.number, approvals);
    } else {
      mergeApprovals(deps.db, providerId, approvals);
    }
  }

  // `nowIso` is captured before the fetch, so the next run re-reads a small
  // overlap rather than skipping anything updated mid-sync.
  setLastSynced(deps.db, providerId, repo.id, nowIso);
  return { repositoryId: repo.id, prCount: fetched.length };
};

export const syncAll = async (
  deps: SyncDeps,
  repos: RepositoryRef[],
  nowIso: string,
): Promise<SyncSummary> => {
  const results: RepoSyncResult[] = [];
  const errors: SyncError[] = [];

  for (const repo of repos) {
    try {
      results.push(await syncRepository(deps, repo, nowIso));
    } catch (err) {
      // One unreachable or renamed repository used to abort every repository
      // after it and report nothing at all. Partial data beats no data.
      errors.push({
        repositoryId: repo.id,
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return { repos: results, errors, totalPrs: results.reduce((sum, r) => sum + r.prCount, 0) };
};
```

- [ ] **Step 5: Rewrite the sync route**

In `src/app/api/sync/route.ts`: validate `{ detail?: "summary" | "full" }` instead of `{ mode?: "fast" | "deep" }`, build the provider via `createProvider(config, process.env)`, and construct `SyncDeps` from it. Return 200 with the summary when at least one repo succeeded; return 500 only when every repo failed:

```ts
    const summary = await syncAll(deps, includedRepos, new Date().toISOString());
    const allFailed = summary.repos.length === 0 && summary.errors.length > 0;
    return NextResponse.json(
      { ...summary, detail },
      { status: allFailed ? 500 : 200 },
    );
```

`includedRepos` becomes `RepositoryRef[]`: `getRepositories(db).filter((r) => r.included).map((r) => ({ id: r.id, defaultBranch: r.defaultBranch }))`.

- [ ] **Step 6: Run the sync tests**

Run: `npx vitest run src/sync/sync.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Full verification**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/sync src/storage src/app
git commit -m "refactor: sync depends on the provider port, not Bitbucket

SyncDeps loses workspace, auth, fetchPRs and fetchActivity — four
Bitbucket-shaped fields — for one provider. The fast/deep modes become
DetailLevel, and the merge-vs-replace approval decision now comes from the
provider's own approvalsAreComplete rather than from the sync mode.

One failing repository no longer aborts the rest: syncAll captures per-repo
errors and returns partial results, and a failed repo's watermark is left
alone so its window is retried rather than skipped forever.

Cached rows carry provider_id, so switching providers cannot mix two hosts'
pull requests into one analysis."
```

---

### Task 12: Rewire the insights route

**Files:**
- Modify: `src/app/api/insights/route.ts`
- Modify: `src/app/api/roster/route.ts` (rename the query functions)

**Interfaces:**
- Consumes: `createProvider` (Task 9), `ProviderInfo` (Task 8), the renamed storage functions (Task 11).
- Produces: `GET /api/insights?window=recent|all` returning `InsightsResponse` including the real `provider` block.

- [ ] **Step 1: Replace the temporary provider literal**

In `src/app/api/insights/route.ts`, delete the `// TEMPORARY: replaced in Task 12` literal from Task 8 and build it from the provider:

```ts
    const provider = createProvider(config, process.env);
    const db = getDb(config.dbPath);
    const people = getPeople(db);
    const repositories = getRepositories(db);
    const prs = getPullRequests(db, provider.id);
    const approvals = getApprovals(db, provider.id);

    const generatedAt = new Date().toISOString();
    const earliestCreated = prs.reduce<string | null>(
      (min, pr) => (min === null || pr.createdOn < min ? pr.createdOn : min),
      null,
    );
    const sinceIso = resolveSinceIso(window, generatedAt, earliestCreated, config.windowMonths);

    const body: InsightsResponse = {
      leaderboard: computeLeaderboard(prs, repositories, people, sinceIso),
      prsCreated: computePrsCreatedMatrix(prs, repositories, people, sinceIso),
      approvals: computeApprovalMatrix(prs, approvals, repositories, people, sinceIso),
      provider: { id: provider.id, label: provider.label, capabilities: provider.capabilities },
      window,
      sinceIso,
      generatedAt,
      windowMonths: config.windowMonths,
    };
```

Add `windowMonths: number` to `InsightsResponse` in `src/core/view/insights.ts` — Task 13's copy needs it to write "Last 6 months" truthfully.

- [ ] **Step 2: Verify the route responds**

Run: `npm run dev` in one terminal, then:

```bash
curl -s "http://localhost:3000/api/insights?window=recent" | head -c 400
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/insights?window=6m"
```

Expected: the first prints JSON containing `"provider":{"id":"bitbucket"`; the second prints `400` (the old key is no longer valid). Stop the dev server afterwards.

If no `.env.local` exists, set `ARGUS_PROVIDER=fixture` for this check so no credentials are needed.

- [ ] **Step 3: Full verification**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app src/core
git commit -m "feat: insights reports which provider produced it and what it can do

The response carries the provider's label and capabilities so the UI can
describe honestly what was measured instead of hardcoding one host's
limitations."
```

---

### Task 13: Presentational UI and capability-driven copy

**Files:**
- Create: `src/ui/copy.ts`, `src/ui/copy.test.ts`
- Modify: `src/ui/MatrixTable.tsx`, `src/ui/MatrixTable.test.tsx`
- Modify: `src/ui/LeaderboardTable.tsx` (renamed from `LeaderboardTab.tsx`)
- Modify: `src/ui/TeamPanel.tsx` (renamed from `TeamTab.tsx`)

**Interfaces:**
- Consumes: `ProviderInfo` (Task 8), `InsightsResponse.windowMonths` (Task 12).
- Produces:
  - `reviewTimeCaveat(provider: ProviderInfo, fallbackPrs: number, totalPrs: number): string[]`
  - `windowDescription(window: AnalysisWindow, windowMonths: number, label: string | null): string`
  - `MATRIX_COPY: { prsCreated: MatrixCopy; approvals: MatrixCopy }` where `MatrixCopy = { rowAxisLabel, colAxisLabel, rowTotalLabel, colTotalLabel, description }`
  - `MatrixTable` props gain `excludeDiagonal?: { note: string }` and `leaderTitle?: (colLabel: string, rowLabel: string) => string`; `matrix.rowUsers` is now `matrix.rowHeaders`

- [ ] **Step 1: Write the failing test**

Create `src/ui/copy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ProviderInfo } from "@/core/capabilities";
import { reviewTimeCaveat, windowDescription } from "./copy";

const bitbucket: ProviderInfo = {
  id: "bitbucket", label: "Bitbucket Cloud",
  capabilities: {
    mergeTimestamps: "derived", readyForReviewTimestamps: "onDemand",
    approvalTimestamps: "onDemand", incrementalByUpdatedAt: true,
  },
};

const exactProvider: ProviderInfo = {
  id: "exact", label: "Exact Host",
  capabilities: {
    mergeTimestamps: "exact", readyForReviewTimestamps: "exact",
    approvalTimestamps: "exact", incrementalByUpdatedAt: true,
  },
};

describe("reviewTimeCaveat", () => {
  it("explains the last-touched proxy when merge times are only derived", () => {
    const lines = reviewTimeCaveat(bitbucket, 0, 10).join(" ");
    expect(lines).toMatch(/last touched/i);
    expect(lines).toContain("Bitbucket Cloud");
  });

  it("says nothing about a merge proxy when the provider reports merges exactly", () => {
    // Printing a caveat that does not apply is worse than printing none.
    const lines = reviewTimeCaveat(exactProvider, 0, 10).join(" ");
    expect(lines).not.toMatch(/last touched/i);
  });

  it("reports how many PRs fell back to creation time", () => {
    expect(reviewTimeCaveat(bitbucket, 3, 10).join(" ")).toMatch(/3 of 10/);
  });

  it("calls out the case where every PR fell back", () => {
    expect(reviewTimeCaveat(bitbucket, 10, 10).join(" ")).toMatch(/all 10/i);
  });

  it("says nothing about fallbacks when there are no PRs to describe", () => {
    expect(reviewTimeCaveat(bitbucket, 0, 0).join(" ")).not.toMatch(/0 of 0/);
  });
});

describe("windowDescription", () => {
  it("names the configured window length rather than assuming six months", () => {
    expect(windowDescription("recent", 3, null)).toMatch(/3 months/);
    expect(windowDescription("recent", 6, null)).toMatch(/6 months/);
  });

  it("includes the formatted date range when one is available", () => {
    expect(windowDescription("recent", 6, "1 Jan 2026 – 1 Jul 2026")).toContain("1 Jan 2026");
  });

  it("describes the all-time view as everything cached", () => {
    expect(windowDescription("all", 6, null)).toMatch(/cache/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/copy.test.ts`
Expected: FAIL — `./copy` does not exist.

- [ ] **Step 3: Write the copy module**

Create `src/ui/copy.ts`. Move the prose currently hardcoded in `LeaderboardTab.tsx` and `page.tsx` here, and make the provider-specific parts conditional on capabilities:

```ts
import type { ProviderInfo } from "@/core/capabilities";
import type { AnalysisWindow } from "@/core/window";

export type MatrixCopy = {
  rowAxisLabel: string;
  colAxisLabel: string;
  rowTotalLabel: string;
  colTotalLabel: string;
  description: string;
};

// Returns one paragraph per line. Generated rather than hardcoded so that a
// provider which reports merge times exactly stops printing a warning about a
// proxy it does not use — a caveat that does not apply is a lie.
export const reviewTimeCaveat = (
  provider: ProviderInfo,
  fallbackPrs: number,
  totalPrs: number,
): string[] => {
  const lines: string[] = [];
  const { mergeTimestamps, readyForReviewTimestamps } = provider.capabilities;

  if (mergeTimestamps === "derived") {
    lines.push(
      `What is measured: created → last touched. ${provider.label} does not expose a merge ` +
        `timestamp on its pull request list, so the end of the interval is the pull request's ` +
        `last activity — the merge for almost all of them, but later if someone commented ` +
        `after it merged.`,
    );
  } else {
    lines.push("What is measured: ready for review → merged.");
  }

  if (readyForReviewTimestamps === "unavailable") {
    lines.push("Every interval starts at creation time: this provider records no draft→ready transition.");
  } else if (totalPrs > 0) {
    lines.push(
      fallbackPrs === totalPrs
        ? `Right now all ${totalPrs} pull requests use creation time as the start — no draft→ready history has been synced.`
        : `Right now ${fallbackPrs} of ${totalPrs} pull requests use creation time as the start; those are flagged * in the expanded list.`,
    );
  }

  lines.push("The window is applied to the end of the interval, so a pull request opened long before it still counts.");
  return lines;
};

export const windowDescription = (
  window: AnalysisWindow,
  windowMonths: number,
  rangeLabel: string | null,
): string => {
  const range = rangeLabel ? `: ${rangeLabel}` : "";
  return window === "recent"
    ? `Rolling ${windowMonths} months${range} — moves with today's date, so it is recalculated on ` +
        `every view and older pull requests drop out of the figures below.`
    : `All time${range} — every pull request held in the local cache. Older periods are patchier, ` +
        `since each repository was only backfilled ${windowMonths} months on its first sync.`;
};

export const MATRIX_COPY: { prsCreated: MatrixCopy; approvals: MatrixCopy } = {
  prsCreated: {
    rowAxisLabel: "Engineer",
    colAxisLabel: "Repository",
    rowTotalLabel: "PRs by engineer",
    colTotalLabel: "PRs in repo",
    description:
      "How many PRs each engineer opened in each repository, counting PRs created inside the selected window above. Merged and still-open PRs count; closed ones do not. Rows are engineers (alphabetical), columns are the included repositories. 'PRs by engineer' totals a row — that engineer's output across every repo; 'PRs in repo' totals a column — everyone's output in that repo. Services counts the distinct repositories an engineer opened at least one PR in — a measure of breadth rather than volume. Blank means no PRs.",
  },
  approvals: {
    rowAxisLabel: "PR author",
    colAxisLabel: "Approver",
    rowTotalLabel: "Approvals received",
    colTotalLabel: "Approvals given",
    description:
      "Who reviews whose work. Read a row as: of this author's PRs, how many each colleague approved. Rows are PR authors and columns are approvers (both alphabetical); self-approvals are excluded, so the diagonal is greyed out. Each row's highest cell is highlighted — that author's most frequent approver (all tied cells are highlighted). Totals count approvals, not PRs: 'Approvals received' totals a row — how many approvals that author's PRs collected in all (one PR can be approved by several people); 'Approvals given' totals a column — how many approvals that person handed out. The last column counts PRs that were merged with no approval from anyone else: they have no approver to attribute, but they still happened. Closed PRs are ignored; the window above is applied to each PR's creation date, not the approval date.",
  },
};
```

- [ ] **Step 4: Run the copy test to verify it passes**

Run: `npx vitest run src/ui/copy.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Make `MatrixTable` generic**

`MatrixTable` currently decides the greyed diagonal by `c.key === u.accountId` and hardcodes the tooltip `"${c.label} approves the most of ${u.displayName}'s PRs"`. Both are the approvals tab leaking into a component the PRs-created tab also uses.

Change the props to:

```tsx
export default function MatrixTable({
  matrix, rowAxisLabel, colAxisLabel, rowTotalLabel, colTotalLabel, description,
  highlightRowMax = false, excludeDiagonal, leaderTitle,
}: {
  matrix: Matrix;
  rowAxisLabel: string;
  colAxisLabel: string;
  rowTotalLabel: string;
  colTotalLabel: string;
  description: string;
  highlightRowMax?: boolean;
  // Set when a cell whose row and column are the same entity is structurally
  // impossible rather than merely empty (self-approval). `note` is its tooltip.
  excludeDiagonal?: { note: string };
  // Tooltip for a highlighted row leader. Supplied by the caller because only
  // it knows what the cells mean.
  leaderTitle?: (colLabel: string, rowLabel: string) => string;
}) {
```

In the body: iterate `matrix.rowHeaders` instead of `matrix.rowUsers`; key rows on `row.key` and render `row.label`; replace the `c.key === u.accountId` test with `excludeDiagonal && c.key === row.key`, rendering `title={excludeDiagonal.note}`; and replace the hardcoded leader tooltip with `leaderTitle?.(c.label, row.label)`.

- [ ] **Step 6: Update `MatrixTable`'s test**

`src/ui/MatrixTable.test.tsx` asserts the diagonal and leader-tooltip behaviour. Update its fixtures to `rowHeaders` and pass the new props explicitly, e.g.:

```tsx
excludeDiagonal={{ note: "Self-approval isn't possible" }}
leaderTitle={(col, row) => `${col} approves the most of ${row}'s PRs`}
```

Add one test proving the generic case: with `excludeDiagonal` omitted and matching row/column keys, the cell renders its value rather than a dash.

```tsx
it("renders matching row and column keys normally when no diagonal is excluded", () => {
  render(
    <MatrixTable
      matrix={{
        rowHeaders: [{ key: "ada", label: "Ada" }],
        colHeaders: [{ key: "ada", label: "Ada" }],
        cells: [[4]], rowTotals: [4], colTotals: [4],
      }}
      rowAxisLabel="Engineer" colAxisLabel="Engineer"
      rowTotalLabel="Total" colTotalLabel="Total" description="d"
    />,
  );
  expect(screen.getByText("4")).toBeDefined();
});
```

- [ ] **Step 7: Rename the two tab components and make them presentational**

`git mv src/ui/LeaderboardTab.tsx src/ui/LeaderboardTable.tsx` and `git mv src/ui/TeamTab.tsx src/ui/TeamPanel.tsx`.

`LeaderboardTable` takes `{ rows, provider }` and renders `reviewTimeCaveat(provider, fallbackPrs, totalPrs)` as paragraphs instead of its hardcoded prose. Keep the reconciliation paragraph, which is provider-independent. `fallbackPrs` and `totalPrs` are already computed at the top of the component; only the prose changes:

```tsx
export default function LeaderboardTable({
  rows, provider,
}: { rows: LeaderboardRow[]; provider: ProviderInfo }) {
  const [open, setOpen] = useState<string | null>(null);
  const totalPrs = rows.reduce((n, r) => n + r.prCount, 0);
  const fallbackPrs = rows.reduce(
    (n, r) => n + r.prs.filter((p) => p.readyForReviewPrecision === "fallback").length, 0,
  );

  return (
    <section>
      <div className="text-sm text-gray-600 mb-3 max-w-4xl space-y-2">
        <p>
          How long each engineer&apos;s PRs stay open before landing, across PRs merged to the
          default branch inside the window above. Ranked by median, which a few very long-lived PRs
          cannot skew; the average is shown alongside for comparison. Click a row to see that
          engineer&apos;s individual PRs, slowest first.
        </p>
        {reviewTimeCaveat(provider, fallbackPrs, totalPrs).map((line) => (
          <p key={line} className="text-gray-500">{line}</p>
        ))}
        {/* Reconciliation paragraph: unchanged, and true of every provider. */}
      </div>
      {/* table unchanged */}
    </section>
  );
}
```

Rows are keyed on `row.personId` after the Task 5 rename.

`TeamPanel` currently calls `fetch` itself — four times. Strip all of it: it takes `{ roster, busy, message, error, onDiscover, onRefresh, onToggle }` and calls the handlers. The fetching moves to `dashboard/` in Task 14.

- [ ] **Step 8: Full verification**

Run: `npm test && npx tsc --noEmit`
Expected: `src/app/page.tsx` will not compile yet — it still passes the old props and imports the old component names. Fix `page.tsx` minimally here (Task 14 restructures it properly): update the imports, pass `MATRIX_COPY.prsCreated` / `MATRIX_COPY.approvals` by spread, pass `provider={insights.provider}` to `LeaderboardTable`, and hoist `TeamPanel`'s former fetch logic into `page.tsx` for now.

Then re-run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/ui src/app
git commit -m "refactor: presentational ui with capability-driven copy

MatrixTable no longer infers the approvals diagonal from its data or hardcodes
an approvals tooltip — both are explicit props, so the PRs-created tab is no
longer rendered by a component that secretly knows about approvals.

All explanatory prose moves to ui/copy.ts and the provider-specific parts are
generated from capabilities: a provider reporting exact merge times stops
printing a warning about a proxy it does not use."
```

---

### Task 14: Container layer and routing-only page

**Files:**
- Create: `src/dashboard/api-client.ts`, `src/dashboard/useRoster.ts`, `src/dashboard/useInsights.ts`, `src/dashboard/Dashboard.tsx`
- Create: `src/dashboard/api-client.test.ts`
- Modify: `src/app/page.tsx` (110 lines → ~5)

**Interfaces:**
- Consumes: `ui/*` (Task 13), `InsightsResponse` (Task 12).
- Produces:
  - `fetchRoster()`, `fetchInsights(window)`, `postDiscover()`, `postSync(detail?)`, `patchInclusion(kind, id, included)` in `api-client.ts`
  - `useRoster()`, `useInsights(window)` hooks
  - `<Dashboard />` — the only export `app/page.tsx` uses

- [ ] **Step 1: Write the failing test**

Create `src/dashboard/api-client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { fetchInsights, patchInclusion, postSync } from "./api-client";

const okJson = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe("fetchInsights", () => {
  it("requests the given window", async () => {
    const fetchFn = vi.fn(async () => okJson({ window: "all" }));
    await fetchInsights("all", fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledWith("/api/insights?window=all");
  });

  it("throws with the server's message on a failure", async () => {
    const fetchFn = vi.fn(async () =>
      ({ ok: false, status: 500, json: async () => ({ error: "boom" }) }) as unknown as Response,
    );
    await expect(fetchInsights("recent", fetchFn as unknown as typeof fetch)).rejects.toThrow("boom");
  });
});

describe("postSync", () => {
  it("sends the detail level in the body", async () => {
    const fetchFn = vi.fn(async () => okJson({ totalPrs: 0, repos: [], errors: [] }));
    await postSync("full", fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledWith("/api/sync", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ detail: "full" }),
    }));
  });
});

describe("patchInclusion", () => {
  it("sends kind, id and included", async () => {
    const fetchFn = vi.fn(async () => okJson({ ok: true }));
    await patchInclusion("repo", "web", true, fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledWith("/api/roster", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ kind: "repo", id: "web", included: true }),
    }));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/dashboard/api-client.test.ts`
Expected: FAIL — `./api-client` does not exist.

- [ ] **Step 3: Write the API client**

Create `src/dashboard/api-client.ts`. Every function takes an injectable `fetchFn` so it is testable without a DOM or a server:

```ts
import type { AnalysisWindow } from "@/core/window";
import type { InsightsResponse } from "@/core/view/insights";
import type { Person, Repository } from "@/core/domain/people";

export type Roster = { users: Person[]; repos: Repository[] };
export type DiscoverResult = { users: number; repos: number };
export type SyncResult = {
  repos: { repositoryId: string; prCount: number }[];
  errors: { repositoryId: string; message: string }[];
  totalPrs: number;
};

// Turns a failed response into an Error carrying the server's own message.
// Silently swallowing these is how the old page ended up showing an empty
// dashboard with no explanation.
const unwrap = async <T>(res: Response): Promise<T> => {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  }
  return body as T;
};

export const fetchRoster = async (fetchFn: typeof fetch = globalThis.fetch): Promise<Roster> =>
  unwrap<Roster>(await fetchFn("/api/roster"));

export const fetchInsights = async (
  window: AnalysisWindow,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<InsightsResponse> =>
  unwrap<InsightsResponse>(await fetchFn(`/api/insights?window=${window}`));

export const postDiscover = async (
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<DiscoverResult> =>
  unwrap<DiscoverResult>(await fetchFn("/api/discover", { method: "POST" }));

export const postSync = async (
  detail: "summary" | "full" = "summary",
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<SyncResult> =>
  unwrap<SyncResult>(
    await fetchFn("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ detail }),
    }),
  );

export const patchInclusion = async (
  kind: "user" | "repo",
  id: string,
  included: boolean,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<void> => {
  await unwrap<{ ok: true }>(
    await fetchFn("/api/roster", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id, included }),
    }),
  );
};
```

- [ ] **Step 4: Run the client test to verify it passes**

Run: `npx vitest run src/dashboard/api-client.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the hooks**

Create `src/dashboard/useRoster.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchRoster, type Roster } from "./api-client";

const EMPTY: Roster = { users: [], repos: [] };

export const useRoster = () => {
  const [roster, setRoster] = useState<Roster>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setRoster(await fetchRoster());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  return { roster, error, reload };
};
```

Create `src/dashboard/useInsights.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import type { AnalysisWindow } from "@/core/window";
import type { InsightsResponse } from "@/core/view/insights";
import { fetchInsights } from "./api-client";

export const useInsights = (window: AnalysisWindow) => {
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchInsights(window)
      .then((data) => { if (!cancelled) { setInsights(data); setError(null); } })
      .catch((e: unknown) => {
        // The old page swallowed this, leaving an empty dashboard and no clue why.
        if (!cancelled) setError(e instanceof Error ? e.message : "Unknown error");
      });
    return () => { cancelled = true; };
  }, [window]);

  return { insights, error };
};
```

Note the dependency change: the old `page.tsx` refetched insights on every tab switch (`[tab, range]`). Insights do not depend on the active tab, so the dependency is `[window]` only. This removes a redundant request without changing what is displayed.

- [ ] **Step 6: Write the container**

Create `src/dashboard/Dashboard.tsx`. Move the whole body of the current `page.tsx` here, plus the discover/sync/toggle handlers that Task 13 hoisted out of `TeamPanel`. It owns: the active tab, the selected window, `useRoster`, `useInsights`, and busy/message/error state for the two actions. It renders `RangeToggle`, `Tabs`, `TeamPanel`, `LeaderboardTable`, and `MatrixTable`, passing `windowDescription(...)` and `MATRIX_COPY` from `ui/copy.ts`.

Surface sync failures: `postSync` now returns an `errors` array, so a partial sync must say so rather than reporting a bare success count.

```tsx
      const result = await postSync();
      const failed = result.errors.length;
      setMessage(
        failed === 0
          ? `Synced ${result.totalPrs} PRs across ${result.repos.length} repositories.`
          : `Synced ${result.totalPrs} PRs across ${result.repos.length} repositories; ${failed} failed.`,
      );
      if (failed > 0) {
        setError(result.errors.map((e) => `${e.repositoryId}: ${e.message}`).join("; "));
      }
```

- [ ] **Step 7: Reduce the page to routing**

Replace `src/app/page.tsx` entirely:

```tsx
import Dashboard from "@/dashboard/Dashboard";

export default function Home() {
  return <Dashboard />;
}
```

- [ ] **Step 8: Verify the app actually renders**

Run: `npm run dev`, then open `http://localhost:3000`. With `ARGUS_PROVIDER=fixture` set, no credentials are needed.

Check all four tabs: Team lists the fixture's people and repositories; the leaderboard, PRs created, and Approvals tabs render without a console error. Confirm the leaderboard shows no "last touched" caveat under the fixture provider (its capabilities are exact) — that is the capability-driven copy working end to end.

Stop the dev server.

- [ ] **Step 9: Full verification**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 10: Commit**

```bash
git add src/dashboard src/app src/ui
git commit -m "refactor: split data fetching from presentation

page.tsx goes from 110 lines of prose, state, and fetch calls to five lines
that render <Dashboard />. TeamPanel no longer calls fetch four times itself.
Fetching lives in dashboard/ behind an injectable fetch, so it is testable
without a DOM or a server.

Two silent failure paths are now surfaced: the old page swallowed insights
and roster errors with an empty .catch(), and a partial sync reported a bare
success count with no mention of the repositories that failed.

Insights also stop refetching on every tab switch — they never depended on
the active tab."
```

---

### Task 15: Enforce the import boundaries

Without this, the layering is a convention nobody checks.

**Files:**
- Create: `src/architecture.test.ts`

**Interfaces:**
- Consumes: the final folder structure.
- Produces: a failing test whenever a disallowed import is added.

- [ ] **Step 1: Write the test**

Create `src/architecture.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

// Which top-level folder under src/ a file belongs to.
const layerOf = (absPath: string): string => relative(SRC, absPath).split("/")[0];

// Each layer may import only from the layers listed. The direction is the whole
// point: core knows nothing about anything, so it can be reasoned about and
// tested on its own, and a new provider cannot reach into the UI.
const ALLOWED: Record<string, string[]> = {
  core: [],
  providers: ["core", "config"],
  storage: ["core"],
  ui: ["core"],
  sync: ["core", "providers", "storage"],
  dashboard: ["core", "ui"],
  app: ["core", "providers", "storage", "sync", "ui", "dashboard", "config"],
  config: [],
};

// Packages a layer must never import, regardless of internal edges.
const BANNED_PACKAGES: Record<string, string[]> = {
  core: ["react", "react-dom", "next", "next/server", "better-sqlite3"],
  ui: ["better-sqlite3", "next/server"],
  storage: ["react", "next", "next/server"],
  providers: ["react", "next/server", "better-sqlite3"],
};

// A test kit, not a test file: it exports helpers built on vitest for other
// tests to call, so importing vitest from it is correct.
const VITEST_IMPORT_EXCEPTIONS = ["providers/provider-contract.ts"];

const sourceFiles = walk(SRC).filter(
  (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith("architecture.test.ts"),
);

const importsOf = (source: string): string[] =>
  [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]);

// Resolves an import specifier to the layer it targets, or null for anything
// that is not internal source (external packages, css, and so on).
const targetLayer = (spec: string, fromFile: string): string | null => {
  if (spec.startsWith("@/")) return spec.slice(2).split("/")[0];
  if (spec.startsWith(".")) {
    const abs = resolve(dirname(fromFile), spec);
    return abs.startsWith(SRC) ? layerOf(abs) : null;
  }
  return null;
};

describe("architecture", () => {
  it("finds source files to check", () => {
    // Guards against the walk silently matching nothing and the suite passing vacuously.
    expect(sourceFiles.length).toBeGreaterThan(20);
  });

  it("only imports along allowed layer edges", () => {
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const from = layerOf(file);
      const allowed = ALLOWED[from];
      if (!allowed) continue; // a loose file directly under src/, e.g. a type shim

      for (const spec of importsOf(readFileSync(file, "utf8"))) {
        const to = targetLayer(spec, file);
        if (to === null || to === from) continue;
        if (!allowed.includes(to)) {
          violations.push(`${relative(SRC, file)} (${from}) must not import ${spec} (${to})`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps banned packages out of the layers that must not use them", () => {
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const from = layerOf(file);
      const banned = BANNED_PACKAGES[from] ?? [];
      const rel = relative(SRC, file);

      for (const spec of importsOf(readFileSync(file, "utf8"))) {
        if (spec === "vitest" && VITEST_IMPORT_EXCEPTIONS.includes(rel)) continue;
        if (banned.some((pkg) => spec === pkg || spec.startsWith(`${pkg}/`))) {
          violations.push(`${rel} (${from}) must not import ${spec}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps config out of every layer but app and providers", () => {
    // Library code takes what it needs as arguments; only the edges read the
    // environment. This is what makes core, storage, and sync testable without env.
    const violations = sourceFiles
      .filter((f) => !["app", "providers", "config"].includes(layerOf(f)))
      .filter((f) => importsOf(readFileSync(f, "utf8")).some((s) => s === "@/config" || s.startsWith("@/config/")))
      .map((f) => relative(SRC, f));

    expect(violations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and fix what it finds**

Run: `npx vitest run src/architecture.test.ts`

Expected: PASS. **If it fails, the violations it lists are real** — fix the code, not the rule. The two most likely findings:
- a `core/` file importing from `@/providers` — invert it by having the provider depend on core
- a `ui/` file importing `@/dashboard` — the dependency runs the other way; pass a prop instead

`providers` is allowed to import `config` because each factory reads its own provider's configuration (`readBitbucketConfig`). If you would rather forbid that too, pass the config into `createProvider` from the route instead.

- [ ] **Step 3: Prove the test actually catches a violation**

Temporarily add `import Database from "better-sqlite3";` to `src/core/analytics/scope.ts`.

Run: `npx vitest run src/architecture.test.ts`
Expected: FAIL, naming `core/analytics/scope.ts` and `better-sqlite3`.

Remove the temporary import and re-run. Expected: PASS. A boundary test that cannot fail is worth nothing — this step is what proves it works.

- [ ] **Step 4: Full verification**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/architecture.test.ts
git commit -m "test: enforce the layer import boundaries

core imports nothing internal and never react, next, or better-sqlite3; ui
imports only core; only app and providers read config. Verified by adding a
deliberate violation and watching it fail."
```

---

### Task 16: Rewrite the documentation

**Files:**
- Modify: `CLAUDE.md` (full rewrite)
- Modify: `README.md` (full rewrite)

**Interfaces:**
- Consumes: the finished structure.
- Produces: docs describing Argus as a provider-agnostic tool.

- [ ] **Step 1: Rewrite `CLAUDE.md`**

Keep the sections that are still true — the four tabs, the metric definitions, the scope rule, tab reconciliation — and update:

- **Stack:** describe the layers and the import direction, not just the libraries.
- **Metric definitions:** state that in-review time depends on provider capabilities, and that "created → last touched" is Bitbucket's case specifically, not a property of Argus.
- **Environment variables:** the Task 1 table — `ARGUS_PROVIDER`, `ARGUS_DB_PATH`, `ARGUS_WINDOW_MONTHS`, `BITBUCKET_*` with no default workspace.
- **Data flow:** `detail=summary|full` rather than `mode=fast|deep`; `?window=recent|all`.
- **Schema:** mention `SCHEMA_VERSION` and that a mismatch rebuilds the cache.
- **New section — "Adding a provider":** implement `PullRequestProvider`, declare `ProviderCapabilities` honestly, map the host's vocabulary in your own `map.ts`, register the factory in `registry.ts`, and run `describeProviderContract` against it. Note that nothing outside `src/providers/<name>/` should need to change, and that `src/architecture.test.ts` will fail if the adapter reaches somewhere it should not.

Remove every remaining MVF reference.

- [ ] **Step 2: Rewrite `README.md`**

Cover: what Argus is, the layered structure with the dependency direction, quick start (`cp .env.local.example .env.local`, fill in, `npm install`, `npm run dev`), running credential-free with `ARGUS_PROVIDER=fixture`, the Discover → tick → Refresh flow, and a pointer to the "Adding a provider" section.

- [ ] **Step 3: Verify no MVF references remain anywhere**

Run: `grep -rni "mvf\|mvfglobal" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next .`
Expected: no matches outside `docs/superpowers/` (the historical specs and plans record the original context and should keep it).

- [ ] **Step 4: Verify the documented quick start actually works**

Run, in a scratch directory outside the repo:

```bash
git clone /home/jeremyadmin/PersonalProjects/pr-dashboard argus-clone
cd argus-clone && npm install && cp .env.local.example .env.local
ARGUS_PROVIDER=fixture npm run dev
```

Expected: the app starts and the Team tab lists the fixture's people and repositories. This is what proves the `.env.local.example` fix from Task 1 works from a genuinely fresh clone. Delete the clone afterwards.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: describe Argus as a provider-agnostic tool

Documents the layer structure and its dependency direction, the new
environment variables, and how to add a provider. Metric definitions now
distinguish what Argus measures from what Bitbucket happens to expose."
```

---

### Task 17: Code review and follow-up work

The review the user asked for. Run it against the whole branch diff, not individual commits.

**Files:** determined by the review.

**Interfaces:**
- Consumes: the completed branch.
- Produces: fixes for what the review finds, or a written justification for each finding not fixed.

- [ ] **Step 1: Confirm the branch is green and complete**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: all tests pass, no type errors, production build succeeds. `npm run build` has not been run since Task 0 — it typechecks the whole app including the routes, so run it before reviewing.

- [ ] **Step 2: Review the full diff**

**REQUIRED SUB-SKILL:** Use superpowers:requesting-code-review.

Scope: `git diff main...feat/provider-agnostic-restructure`.

Direct the review at the things this refactor could plausibly have broken:
- **Behaviour parity.** Does any analytics path compute a different number than before? The migrated tests are the evidence; check none had its substance weakened to make it pass.
- **The port's honesty.** Are `BITBUCKET_CAPABILITIES` accurate? Does `approvalsAreComplete` genuinely reproduce the old merge-vs-replace behaviour in both directions?
- **SQL correctness.** The `provider_id` threading touched every statement. Are the `ON CONFLICT` targets still the real primary keys? Is `COLLATE NOCASE` still on both roster queries?
- **Leaks.** Does any Bitbucket word survive outside `src/providers/bitbucket/`? Does any component fetch?
- **The precision rule.** Can a `summary` sync still overwrite a `derived` ready time with a `fallback` one? That regression would be silent.

- [ ] **Step 3: Act on the findings**

**REQUIRED SUB-SKILL:** Use superpowers:receiving-code-review.

Fix what is genuinely wrong. Where a finding is mistaken, say why rather than complying. Commit fixes in focused commits, each with tests green.

- [ ] **Step 4: Verify before claiming done**

**REQUIRED SUB-SKILL:** Use superpowers:verification-before-completion.

```bash
npm test && npx tsc --noEmit && npm run build
grep -rn "TEMPORARY\|TODO\|FIXME" src/
grep -rni "mvf" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next --exclude-dir=docs .
```

Expected: green on all three commands; no `TEMPORARY` marker (Task 8's literal must be gone); no MVF references outside `docs/`.

- [ ] **Step 5: Decide how to integrate**

**REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch.

Note: nothing has been pushed to `origin` at any point in this plan. Confirm with the user before the first push.

---

## Verification Summary

| Task | Verify with |
|---|---|
| 0 | `npm test` → 63 tests; `npx tsc --noEmit` |
| 1 | 7 config tests; `git check-ignore` shows `.env.local` ignored, example not |
| 2 | 3 schema tests including rebuild-on-mismatch |
| 3 | 3 state-normalisation tests; `grep` finds no stray `DECLINED` |
| 4 | precision tests; `grep -rn "readyIsFallback"` empty |
| 5 | test count unchanged; all six rename greps empty |
| 6 | window tests; `grep` finds no `sixMonthsAgo` / `"6m"` |
| 7 | test count unchanged; `grep -rn "@/lib/\|@/types\|@/components"` empty |
| 8 | `tsc` clean with the provider block added |
| 9 | 6 map tests |
| 10 | contract suite passes against **both** fixture and Bitbucket (9 each) |
| 11 | 5 sync tests including partial failure and watermark-not-advanced |
| 12 | `curl` shows the provider block; `?window=6m` returns 400 |
| 13 | 8 copy tests; MatrixTable generic-diagonal test |
| 14 | 4 api-client tests; all four tabs render under `ARGUS_PROVIDER=fixture` |
| 15 | boundary test passes, **and** fails when a violation is deliberately added |
| 16 | fresh `git clone` + `npm install` + fixture provider starts |
| 17 | `npm test && npx tsc --noEmit && npm run build`; no `TEMPORARY`/MVF markers |
