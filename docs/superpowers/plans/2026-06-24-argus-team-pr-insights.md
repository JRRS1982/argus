# Argus — Team PR Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build "Argus", a local Next.js dashboard that turns Bitbucket PR history into team code-review insights: a review-time leaderboard, a PRs-created matrix, and an approval matrix, backed by an incrementally-refreshed local SQLite cache.

**Architecture:** Extend the existing `pr-review-dashboard` repo. Add a `better-sqlite3` cache and a layered, pure-function core: `lib/bitbucket/` (typed API client, `fetch` injected), `lib/db/` (schema + typed queries), `lib/sync/` (Bitbucket→DB orchestration), `lib/analytics/` (pure view-model builders). API routes trigger discover/sync and serve computed view models to a tabbed client UI.

**Tech Stack:** Next.js 16.1.6 (App Router), React 19, TypeScript 5, Tailwind CSS v4, better-sqlite3, Vitest (+ @testing-library/react, jsdom for component tests). Bitbucket Cloud REST API v2.0.

## Global Constraints

- Runtime/deps: Next.js `16.1.6`, React `19.2.3`, TypeScript `^5`, Tailwind `^4` — already pinned in `package.json`; do not change versions.
- Pure functions throughout the `lib/analytics/` layer — no I/O (no `fetch`, no DB driver) inside analytics.
- All Bitbucket API access goes through `src/lib/bitbucket/client.ts`; the client and all fetch functions accept an injectable `fetchFn: typeof fetch` (default `globalThis.fetch`) for testability.
- Bitbucket auth: HTTP Basic from `BITBUCKET_EMAIL` + `BITBUCKET_API_TOKEN` env vars (existing pattern). API base: `https://api.bitbucket.org/2.0`.
- Bitbucket PR ids are unique **per repo only** — every PR key is the pair `(repoSlug, id)`; never key a PR by `id` alone.
- API routes that touch SQLite or the network MUST declare `export const runtime = "nodejs"` (better-sqlite3 is a native module; it cannot run on the Edge runtime).
- Time window for all insights: last 6 months, expressed as an ISO `sinceIso` string computed once per request and passed down (never call `new Date()` inside analytics).
- Commit after every task with a Conventional Commits message.
- App branding/title is "Argus"; the repo folder and package name stay `pr-review-dashboard`.

---

## File Structure

**Created:**
- `vitest.config.ts` — test runner config
- `src/lib/db/schema.ts` — SQLite DDL string + `applySchema(db)`
- `src/lib/db/index.ts` — `getDb()` singleton + schema bootstrap
- `src/lib/db/queries.ts` — typed read/write query functions
- `src/lib/db/queries.test.ts`
- `src/lib/bitbucket/client.ts` — auth + generic paginated GET (`fetchFn` injected)
- `src/lib/bitbucket/client.test.ts`
- `src/lib/bitbucket/discover.ts` — `fetchWorkspaceMembers`, `fetchRepos`
- `src/lib/bitbucket/discover.test.ts`
- `src/lib/bitbucket/pulls.ts` — PR list + activity fetch, `deriveReadyForReview`, `extractApprovals`
- `src/lib/bitbucket/pulls.test.ts`
- `src/lib/sync/sync.ts` — `syncAll` / `syncRepo` orchestration
- `src/lib/sync/sync.test.ts`
- `src/lib/analytics/duration.ts` — `reviewDurationMs`
- `src/lib/analytics/duration.test.ts`
- `src/lib/analytics/leaderboard.ts` — `computeLeaderboard`
- `src/lib/analytics/leaderboard.test.ts`
- `src/lib/analytics/matrices.ts` — `computePrsCreatedMatrix`, `computeApprovalMatrix`
- `src/lib/analytics/matrices.test.ts`
- `src/lib/window.ts` — `sixMonthsAgoIso(nowIso)` window helper
- `src/lib/window.test.ts`
- `src/app/api/discover/route.ts` — POST discover members+repos
- `src/app/api/sync/route.ts` — POST incremental sync
- `src/app/api/roster/route.ts` — GET roster, PATCH include toggles
- `src/app/api/insights/route.ts` — GET computed view models
- `src/components/Tabs.tsx` — tab shell
- `src/components/TeamTab.tsx` — roster table + Discover/Refresh buttons + toggles
- `src/components/LeaderboardTab.tsx` — expandable author rows
- `src/components/MatrixTable.tsx` — reusable matrix renderer
- `src/components/MatrixTable.test.tsx`

**Modified:**
- `package.json` — add deps + `test` script
- `src/types/index.ts` — add domain + view-model types
- `src/config/index.ts` — reduce to `{ workspace, projectKey, dbPath }`
- `src/app/page.tsx` — replace with Argus tab host
- `src/app/layout.tsx` — update title metadata to "Argus"
- `.env.local.example` — keep Bitbucket vars (Jira vars no longer needed)
- `CLAUDE.md`, `README.md` — update to describe Argus
- `.gitignore` — ignore the SQLite DB file

---

## Task 1: Project baseline, dependencies, and test harness

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/lib/window.ts`, `src/lib/window.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `sixMonthsAgoIso(nowIso: string): string` in `src/lib/window.ts`

- [ ] **Step 1: Commit the existing uncommitted dashboard to `main`, then branch**

```bash
cd /home/jeremyadmin/Projects/pr-review-dashboard
git add -A
git commit -m "chore: commit existing PR review dashboard baseline"
git checkout -b feat/argus-team-pr-insights
```

- [ ] **Step 2: Install dependencies**

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3 vitest @testing-library/react @testing-library/dom jsdom @vitejs/plugin-react
```

- [ ] **Step 3: Add the `test` script to `package.json`**

In `package.json`, change the `scripts` block to:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node", // component tests opt into jsdom via a per-file pragma
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

- [ ] **Step 5: Ignore the SQLite DB in `.gitignore`**

Append to `.gitignore`:

```
# Local Argus data cache
*.sqlite
*.sqlite-journal
data/
```

- [ ] **Step 6: Write the failing test for the window helper**

Create `src/lib/window.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sixMonthsAgoIso } from "@/lib/window";

describe("sixMonthsAgoIso", () => {
  it("returns the ISO timestamp exactly six months before the given instant", () => {
    expect(sixMonthsAgoIso("2026-06-24T00:00:00.000Z")).toBe("2025-12-24T00:00:00.000Z");
  });

  it("handles month-length underflow by rolling to a valid date", () => {
    // 2026-03-31 minus 6 months -> Sept has 30 days, JS rolls to Oct 1
    const result = sixMonthsAgoIso("2026-03-31T12:00:00.000Z");
    expect(result.startsWith("2025-10-01")).toBe(true);
  });
});
```

- [ ] **Step 7: Run the test and confirm it fails**

Run: `npm test -- src/lib/window.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/window"`.

- [ ] **Step 8: Implement `src/lib/window.ts`**

```ts
// Returns the ISO timestamp six months before `nowIso`.
// Pure: caller supplies the reference instant so the result is testable.
export const sixMonthsAgoIso = (nowIso: string): string => {
  const d = new Date(nowIso);
  d.setMonth(d.getMonth() - 6);
  return d.toISOString();
};
```

- [ ] **Step 9: Run the test and confirm it passes**

Run: `npm test -- src/lib/window.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json vitest.config.ts .gitignore src/lib/window.ts src/lib/window.test.ts
git commit -m "chore: add sqlite + vitest harness and window helper"
```

---

## Task 2: Domain types

**Files:**
- Modify: `src/types/index.ts`

**Interfaces:**
- Produces (all exported from `@/types`):
  - `PullRequestState = "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED"`
  - `PullRequestRecord`, `ApprovalRecord`, `UserRecord`, `RepoRecord`
  - View models: `LeaderboardPR`, `LeaderboardRow`, `Matrix`, `InsightsResponse`

- [ ] **Step 1: Append the new types to `src/types/index.ts`**

Keep the existing `CellMetrics`/`MonthColumn`/`User`/`ReviewData` exports (legacy code still imports them); add below them:

```ts
// ── Argus domain types ───────────────────────────────────────────────

export type PullRequestState = "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED";

export type PullRequestRecord = {
  id: number;              // Bitbucket PR id — unique only within its repo
  repoSlug: string;
  authorAccountId: string;
  title: string;
  state: PullRequestState;
  createdOn: string;       // ISO
  readyForReviewOn: string; // ISO; equals createdOn when no draft transition found
  readyIsFallback: boolean; // true when readyForReviewOn fell back to createdOn
  mergedOn: string | null; // ISO or null
  destinationBranch: string;
  url: string;
};

export type ApprovalRecord = {
  repoSlug: string;
  prId: number;
  approverAccountId: string;
  approvedOn: string | null; // ISO; null if the API omitted a timestamp
};

export type UserRecord = {
  accountId: string;
  displayName: string;
  included: boolean;
};

export type RepoRecord = {
  slug: string;
  name: string;
  projectKey: string | null;
  mainBranch: string;
  included: boolean;
};

// ── View models ──────────────────────────────────────────────────────

export type LeaderboardPR = {
  id: number;
  repoSlug: string;
  title: string;
  url: string;
  reviewMs: number;
  readyIsFallback: boolean;
};

export type LeaderboardRow = {
  accountId: string;
  displayName: string;
  prCount: number;
  averageReviewMs: number;
  prs: LeaderboardPR[]; // sorted slowest-first within the row
};

export type Matrix = {
  rowUsers: { accountId: string; displayName: string }[];
  colHeaders: { key: string; label: string }[];
  cells: number[][];   // cells[rowIndex][colIndex]
  rowTotals: number[];
  colTotals: number[];
};

export type InsightsResponse = {
  leaderboard: LeaderboardRow[];
  prsCreated: Matrix;
  approvals: Matrix;
  sinceIso: string;
  generatedAt: string;
};
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add Argus domain and view-model types"
```

---

## Task 3: SQLite schema and database module

**Files:**
- Create: `src/lib/db/schema.ts`
- Create: `src/lib/db/index.ts`
- Modify: `src/config/index.ts`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces:
  - `applySchema(db: Database.Database): void` in `src/lib/db/schema.ts`
  - `getDb(): Database.Database` in `src/lib/db/index.ts` (singleton, schema applied on first open)
  - `config = { workspace: string; projectKey: string | null; dbPath: string }` in `src/config/index.ts`

- [ ] **Step 1: Replace `src/config/index.ts`**

```ts
export type AppConfig = {
  workspace: string;       // Bitbucket workspace slug, e.g. "mvfglobal"
  projectKey: string | null; // optional Bitbucket project key to scope repos; null = whole workspace
  dbPath: string;          // path to the SQLite cache file
};

export const config: AppConfig = {
  workspace: process.env.BITBUCKET_WORKSPACE ?? "mvfglobal",
  projectKey: process.env.BITBUCKET_PROJECT_KEY ?? null,
  dbPath: process.env.ARGUS_DB_PATH ?? "data/argus.sqlite",
};
```

- [ ] **Step 2: Create `src/lib/db/schema.ts`**

```ts
import type Database from "better-sqlite3";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  account_id   TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  included     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS repos (
  slug         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  project_key  TEXT,
  main_branch  TEXT NOT NULL DEFAULT 'main',
  included     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pull_requests (
  repo_slug          TEXT NOT NULL,
  id                 INTEGER NOT NULL,
  author_account_id  TEXT NOT NULL,
  title              TEXT NOT NULL,
  state              TEXT NOT NULL,
  created_on         TEXT NOT NULL,
  ready_for_review_on TEXT NOT NULL,
  ready_is_fallback  INTEGER NOT NULL DEFAULT 1,
  merged_on          TEXT,
  destination_branch TEXT NOT NULL,
  url                TEXT NOT NULL,
  PRIMARY KEY (repo_slug, id)
);

CREATE TABLE IF NOT EXISTS approvals (
  repo_slug           TEXT NOT NULL,
  pr_id               INTEGER NOT NULL,
  approver_account_id TEXT NOT NULL,
  approved_on         TEXT,
  PRIMARY KEY (repo_slug, pr_id, approver_account_id)
);

CREATE TABLE IF NOT EXISTS sync_state (
  repo_slug      TEXT PRIMARY KEY,
  last_synced_on TEXT NOT NULL
);
`;

export const applySchema = (db: Database.Database): void => {
  db.exec(SCHEMA_SQL);
};
```

- [ ] **Step 3: Create `src/lib/db/index.ts`**

```ts
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "@/config";
import { applySchema } from "./schema";

let instance: Database.Database | null = null;

// Returns a process-wide singleton DB handle with the schema applied.
export const getDb = (): Database.Database => {
  if (instance) return instance;
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applySchema(db);
  instance = db;
  return instance;
};
```

- [ ] **Step 4: Write a failing test for the schema**

Create `src/lib/db/queries.test.ts` (we start it here; Task 4 adds to it):

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "@/lib/db/schema";

const freshDb = () => {
  const db = new Database(":memory:");
  applySchema(db);
  return db;
};

describe("applySchema", () => {
  it("creates all five tables", () => {
    const db = freshDb();
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toEqual(["approvals", "pull_requests", "repos", "sync_state", "users"]);
    db.close();
  });
});
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npm test -- src/lib/db/queries.test.ts`
Expected: PASS (1 test). (The schema is implemented, so this is green immediately — it guards the DDL.)

- [ ] **Step 6: Commit**

```bash
git add src/config/index.ts src/lib/db/schema.ts src/lib/db/index.ts src/lib/db/queries.test.ts
git commit -m "feat: add sqlite schema, db singleton, and slimmed config"
```

---

## Task 4: Database query functions

**Files:**
- Create: `src/lib/db/queries.ts`
- Modify: `src/lib/db/queries.test.ts`

**Interfaces:**
- Consumes: `applySchema` (Task 3), domain types (Task 2).
- Produces (all take `db: Database.Database` as first arg):
  - `upsertUsers(db, users: { accountId; displayName }[]): void` — inserts new, preserves existing `included`
  - `upsertRepos(db, repos: { slug; name; projectKey; mainBranch }[]): void` — inserts new, preserves existing `included`
  - `setUserIncluded(db, accountId: string, included: boolean): void`
  - `setRepoIncluded(db, slug: string, included: boolean): void`
  - `upsertPullRequest(db, pr: PullRequestRecord): void`
  - `replaceApprovals(db, repoSlug: string, prId: number, approvals: ApprovalRecord[]): void`
  - `getUsers(db): UserRecord[]`
  - `getRepos(db): RepoRecord[]`
  - `getPullRequests(db): PullRequestRecord[]`
  - `getApprovals(db): ApprovalRecord[]`
  - `getLastSynced(db, repoSlug: string): string | null`
  - `setLastSynced(db, repoSlug: string, iso: string): void`

- [ ] **Step 1: Write failing tests**

Append to `src/lib/db/queries.test.ts`:

```ts
import {
  upsertUsers, upsertRepos, setUserIncluded, setRepoIncluded,
  upsertPullRequest, replaceApprovals,
  getUsers, getRepos, getPullRequests, getApprovals,
  getLastSynced, setLastSynced,
} from "@/lib/db/queries";
import type { PullRequestRecord, ApprovalRecord } from "@/types";

const samplePr = (over: Partial<PullRequestRecord> = {}): PullRequestRecord => ({
  id: 1, repoSlug: "repo-a", authorAccountId: "u1", title: "PR", state: "MERGED",
  createdOn: "2026-01-01T00:00:00.000Z", readyForReviewOn: "2026-01-01T00:00:00.000Z",
  readyIsFallback: true, mergedOn: "2026-01-02T00:00:00.000Z",
  destinationBranch: "main", url: "https://x/1", ...over,
});

describe("user/repo upserts preserve include flags", () => {
  it("does not reset included on re-upsert", () => {
    const db = freshDb();
    upsertUsers(db, [{ accountId: "u1", displayName: "Alice" }]);
    setUserIncluded(db, "u1", false);
    upsertUsers(db, [{ accountId: "u1", displayName: "Alice Renamed" }]);
    const [u] = getUsers(db);
    expect(u.included).toBe(false);
    expect(u.displayName).toBe("Alice Renamed");
    db.close();
  });
});

describe("pull request + approval persistence", () => {
  it("upserts a PR and round-trips it", () => {
    const db = freshDb();
    upsertPullRequest(db, samplePr());
    upsertPullRequest(db, samplePr({ title: "Updated" })); // same (repo,id) -> update
    const prs = getPullRequests(db);
    expect(prs).toHaveLength(1);
    expect(prs[0].title).toBe("Updated");
    expect(prs[0].mergedOn).toBe("2026-01-02T00:00:00.000Z");
    db.close();
  });

  it("treats same id in different repos as distinct PRs", () => {
    const db = freshDb();
    upsertPullRequest(db, samplePr({ repoSlug: "repo-a", id: 7 }));
    upsertPullRequest(db, samplePr({ repoSlug: "repo-b", id: 7 }));
    expect(getPullRequests(db)).toHaveLength(2);
    db.close();
  });

  it("replaceApprovals overwrites prior approvals for that PR", () => {
    const db = freshDb();
    const a = (acc: string): ApprovalRecord => ({ repoSlug: "repo-a", prId: 1, approverAccountId: acc, approvedOn: null });
    replaceApprovals(db, "repo-a", 1, [a("u2"), a("u3")]);
    replaceApprovals(db, "repo-a", 1, [a("u2")]);
    const all = getApprovals(db);
    expect(all.map((x) => x.approverAccountId)).toEqual(["u2"]);
    db.close();
  });
});

describe("sync_state", () => {
  it("returns null before set, then the stored value", () => {
    const db = freshDb();
    expect(getLastSynced(db, "repo-a")).toBeNull();
    setLastSynced(db, "repo-a", "2026-06-01T00:00:00.000Z");
    setLastSynced(db, "repo-a", "2026-06-02T00:00:00.000Z");
    expect(getLastSynced(db, "repo-a")).toBe("2026-06-02T00:00:00.000Z");
    db.close();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- src/lib/db/queries.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/db/queries"`.

- [ ] **Step 3: Implement `src/lib/db/queries.ts`**

```ts
import type Database from "better-sqlite3";
import type {
  PullRequestRecord, ApprovalRecord, UserRecord, RepoRecord, PullRequestState,
} from "@/types";

export const upsertUsers = (
  db: Database.Database,
  users: { accountId: string; displayName: string }[],
): void => {
  const stmt = db.prepare(
    `INSERT INTO users (account_id, display_name, included) VALUES (@accountId, @displayName, 1)
     ON CONFLICT(account_id) DO UPDATE SET display_name = excluded.display_name`,
  );
  const tx = db.transaction((rows: typeof users) => rows.forEach((r) => stmt.run(r)));
  tx(users);
};

export const upsertRepos = (
  db: Database.Database,
  repos: { slug: string; name: string; projectKey: string | null; mainBranch: string }[],
): void => {
  const stmt = db.prepare(
    `INSERT INTO repos (slug, name, project_key, main_branch, included)
     VALUES (@slug, @name, @projectKey, @mainBranch, 1)
     ON CONFLICT(slug) DO UPDATE SET
       name = excluded.name,
       project_key = excluded.project_key,
       main_branch = excluded.main_branch`,
  );
  const tx = db.transaction((rows: typeof repos) => rows.forEach((r) => stmt.run(r)));
  tx(repos);
};

export const setUserIncluded = (db: Database.Database, accountId: string, included: boolean): void => {
  db.prepare(`UPDATE users SET included = ? WHERE account_id = ?`).run(included ? 1 : 0, accountId);
};

export const setRepoIncluded = (db: Database.Database, slug: string, included: boolean): void => {
  db.prepare(`UPDATE repos SET included = ? WHERE slug = ?`).run(included ? 1 : 0, slug);
};

export const upsertPullRequest = (db: Database.Database, pr: PullRequestRecord): void => {
  db.prepare(
    `INSERT INTO pull_requests
       (repo_slug, id, author_account_id, title, state, created_on,
        ready_for_review_on, ready_is_fallback, merged_on, destination_branch, url)
     VALUES
       (@repoSlug, @id, @authorAccountId, @title, @state, @createdOn,
        @readyForReviewOn, @readyIsFallback, @mergedOn, @destinationBranch, @url)
     ON CONFLICT(repo_slug, id) DO UPDATE SET
       author_account_id = excluded.author_account_id,
       title = excluded.title,
       state = excluded.state,
       created_on = excluded.created_on,
       ready_for_review_on = excluded.ready_for_review_on,
       ready_is_fallback = excluded.ready_is_fallback,
       merged_on = excluded.merged_on,
       destination_branch = excluded.destination_branch,
       url = excluded.url`,
  ).run({ ...pr, readyIsFallback: pr.readyIsFallback ? 1 : 0 });
};

export const replaceApprovals = (
  db: Database.Database, repoSlug: string, prId: number, approvals: ApprovalRecord[],
): void => {
  const del = db.prepare(`DELETE FROM approvals WHERE repo_slug = ? AND pr_id = ?`);
  const ins = db.prepare(
    `INSERT OR REPLACE INTO approvals (repo_slug, pr_id, approver_account_id, approved_on)
     VALUES (@repoSlug, @prId, @approverAccountId, @approvedOn)`,
  );
  const tx = db.transaction(() => {
    del.run(repoSlug, prId);
    approvals.forEach((a) => ins.run(a));
  });
  tx();
};

type UserRow = { account_id: string; display_name: string; included: number };
export const getUsers = (db: Database.Database): UserRecord[] =>
  (db.prepare(`SELECT account_id, display_name, included FROM users ORDER BY display_name`).all() as UserRow[])
    .map((r) => ({ accountId: r.account_id, displayName: r.display_name, included: !!r.included }));

type RepoRow = { slug: string; name: string; project_key: string | null; main_branch: string; included: number };
export const getRepos = (db: Database.Database): RepoRecord[] =>
  (db.prepare(`SELECT slug, name, project_key, main_branch, included FROM repos ORDER BY name`).all() as RepoRow[])
    .map((r) => ({ slug: r.slug, name: r.name, projectKey: r.project_key, mainBranch: r.main_branch, included: !!r.included }));

type PrRow = {
  repo_slug: string; id: number; author_account_id: string; title: string; state: string;
  created_on: string; ready_for_review_on: string; ready_is_fallback: number;
  merged_on: string | null; destination_branch: string; url: string;
};
export const getPullRequests = (db: Database.Database): PullRequestRecord[] =>
  (db.prepare(`SELECT * FROM pull_requests`).all() as PrRow[]).map((r) => ({
    id: r.id, repoSlug: r.repo_slug, authorAccountId: r.author_account_id, title: r.title,
    state: r.state as PullRequestState, createdOn: r.created_on, readyForReviewOn: r.ready_for_review_on,
    readyIsFallback: !!r.ready_is_fallback, mergedOn: r.merged_on,
    destinationBranch: r.destination_branch, url: r.url,
  }));

type ApprovalRow = { repo_slug: string; pr_id: number; approver_account_id: string; approved_on: string | null };
export const getApprovals = (db: Database.Database): ApprovalRecord[] =>
  (db.prepare(`SELECT * FROM approvals`).all() as ApprovalRow[]).map((r) => ({
    repoSlug: r.repo_slug, prId: r.pr_id, approverAccountId: r.approver_account_id, approvedOn: r.approved_on,
  }));

export const getLastSynced = (db: Database.Database, repoSlug: string): string | null => {
  const row = db.prepare(`SELECT last_synced_on FROM sync_state WHERE repo_slug = ?`).get(repoSlug) as
    | { last_synced_on: string } | undefined;
  return row ? row.last_synced_on : null;
};

export const setLastSynced = (db: Database.Database, repoSlug: string, iso: string): void => {
  db.prepare(
    `INSERT INTO sync_state (repo_slug, last_synced_on) VALUES (?, ?)
     ON CONFLICT(repo_slug) DO UPDATE SET last_synced_on = excluded.last_synced_on`,
  ).run(repoSlug, iso);
};
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- src/lib/db/queries.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/queries.ts src/lib/db/queries.test.ts
git commit -m "feat: add typed sqlite query functions"
```

---

## Task 5: Bitbucket client (auth + paginated GET)

**Files:**
- Create: `src/lib/bitbucket/client.ts`
- Create: `src/lib/bitbucket/client.test.ts`

**Interfaces:**
- Produces:
  - `BITBUCKET_API = "https://api.bitbucket.org/2.0"`
  - `type FetchFn = typeof fetch`
  - `getAuthHeader(): string`
  - `bitbucketGet<T>(url: string, auth: string, fetchFn?: FetchFn): Promise<T>`
  - `fetchAllPages<T>(firstUrl: string, auth: string, fetchFn?: FetchFn): Promise<T[]>` — follows the `next` cursor, concatenating `values`

- [ ] **Step 1: Write failing tests**

Create `src/lib/bitbucket/client.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { fetchAllPages, bitbucketGet } from "@/lib/bitbucket/client";

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, statusText: "OK", json: async () => body }) as Response;

describe("fetchAllPages", () => {
  it("follows the next cursor and concatenates values", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ values: [{ id: 1 }, { id: 2 }], next: "page2" }))
      .mockResolvedValueOnce(jsonResponse({ values: [{ id: 3 }] }));
    const all = await fetchAllPages<{ id: number }>("page1", "auth", fetchFn as unknown as typeof fetch);
    expect(all.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("bitbucketGet", () => {
  it("throws a descriptive error on non-ok responses", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" } as Response);
    await expect(bitbucketGet("u", "auth", fetchFn as unknown as typeof fetch)).rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- src/lib/bitbucket/client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/bitbucket/client.ts`**

```ts
export const BITBUCKET_API = "https://api.bitbucket.org/2.0";

export type FetchFn = typeof fetch;

export const getAuthHeader = (): string => {
  const email = process.env.BITBUCKET_EMAIL;
  const token = process.env.BITBUCKET_API_TOKEN;
  if (!email || !token) {
    throw new Error("Missing BITBUCKET_EMAIL or BITBUCKET_API_TOKEN env vars");
  }
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
};

export const bitbucketGet = async <T>(
  url: string,
  auth: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<T> => {
  const res = await fetchFn(url, { headers: { Authorization: auth } });
  if (!res.ok) {
    throw new Error(`Bitbucket API error: ${res.status} ${res.statusText} — ${url}`);
  }
  return (await res.json()) as T;
};

type Page<T> = { values: T[]; next?: string };

export const fetchAllPages = async <T>(
  firstUrl: string,
  auth: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<T[]> => {
  const out: T[] = [];
  let next: string | undefined = firstUrl;
  while (next) {
    const page: Page<T> = await bitbucketGet<Page<T>>(next, auth, fetchFn);
    out.push(...page.values);
    next = page.next;
  }
  return out;
};
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- src/lib/bitbucket/client.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bitbucket/client.ts src/lib/bitbucket/client.test.ts
git commit -m "feat: add bitbucket client with injectable fetch and pagination"
```

---

## Task 6: Bitbucket discovery (members + repos)

**Files:**
- Create: `src/lib/bitbucket/discover.ts`
- Create: `src/lib/bitbucket/discover.test.ts`

**Interfaces:**
- Consumes: `BITBUCKET_API`, `FetchFn`, `fetchAllPages` (Task 5).
- Produces:
  - `fetchWorkspaceMembers(workspace: string, auth: string, fetchFn?: FetchFn): Promise<{ accountId: string; displayName: string }[]>`
  - `fetchRepos(workspace: string, projectKey: string | null, auth: string, fetchFn?: FetchFn): Promise<{ slug: string; name: string; projectKey: string | null; mainBranch: string }[]>`

- [ ] **Step 1: Write failing tests**

Create `src/lib/bitbucket/discover.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { fetchWorkspaceMembers, fetchRepos } from "@/lib/bitbucket/discover";

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, statusText: "OK", json: async () => body }) as Response;

describe("fetchWorkspaceMembers", () => {
  it("maps members to accountId + displayName", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse({ values: [{ user: { account_id: "u1", display_name: "Alice" } }] }),
    );
    const members = await fetchWorkspaceMembers("ws", "auth", fetchFn as unknown as typeof fetch);
    expect(members).toEqual([{ accountId: "u1", displayName: "Alice" }]);
  });
});

describe("fetchRepos", () => {
  it("maps repos and reads the main branch name, defaulting to 'main'", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        values: [
          { slug: "repo-a", name: "Repo A", project: { key: "PROJ" }, mainbranch: { name: "master" } },
          { slug: "repo-b", name: "Repo B" },
        ],
      }),
    );
    const repos = await fetchRepos("ws", null, "auth", fetchFn as unknown as typeof fetch);
    expect(repos).toEqual([
      { slug: "repo-a", name: "Repo A", projectKey: "PROJ", mainBranch: "master" },
      { slug: "repo-b", name: "Repo B", projectKey: null, mainBranch: "main" },
    ]);
  });

  it("adds a project filter to the query when projectKey is given", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse({ values: [] }));
    await fetchRepos("ws", "PROJ", "auth", fetchFn as unknown as typeof fetch);
    const calledUrl = (fetchFn.mock.calls[0][0] as string);
    expect(calledUrl).toContain('project.key="PROJ"');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- src/lib/bitbucket/discover.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/bitbucket/discover.ts`**

```ts
import { BITBUCKET_API, fetchAllPages, type FetchFn } from "./client";

type MemberValue = { user: { account_id: string; display_name: string } };
type RepoValue = {
  slug: string;
  name: string;
  project?: { key: string };
  mainbranch?: { name: string };
};

export const fetchWorkspaceMembers = async (
  workspace: string,
  auth: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<{ accountId: string; displayName: string }[]> => {
  const url = `${BITBUCKET_API}/workspaces/${workspace}/members?pagelen=100`;
  const values = await fetchAllPages<MemberValue>(url, auth, fetchFn);
  return values.map((v) => ({ accountId: v.user.account_id, displayName: v.user.display_name }));
};

export const fetchRepos = async (
  workspace: string,
  projectKey: string | null,
  auth: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<{ slug: string; name: string; projectKey: string | null; mainBranch: string }[]> => {
  const fields = "fields=values.slug,values.name,values.project.key,values.mainbranch.name,next";
  const query = projectKey ? `&q=${encodeURIComponent(`project.key="${projectKey}"`)}` : "";
  const url = `${BITBUCKET_API}/repositories/${workspace}?pagelen=100&${fields}${query}`;
  const values = await fetchAllPages<RepoValue>(url, auth, fetchFn);
  return values.map((v) => ({
    slug: v.slug,
    name: v.name,
    projectKey: v.project?.key ?? null,
    mainBranch: v.mainbranch?.name ?? "main",
  }));
};
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- src/lib/bitbucket/discover.test.ts`
Expected: PASS (3 tests).

> Note on the project filter: the test asserts the *decoded* substring `project.key="PROJ"` is present; `encodeURIComponent` percent-encodes the quotes/spaces, but `toContain` matches the raw decoded fragment only if encoding leaves it intact. If this assertion fails because of encoding, change the test to assert `decodeURIComponent(calledUrl)` contains `project.key="PROJ"`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bitbucket/discover.ts src/lib/bitbucket/discover.test.ts
git commit -m "feat: add bitbucket workspace member and repo discovery"
```

---

## Task 7: Bitbucket pull-request fetching, draft & approval parsing

**Files:**
- Create: `src/lib/bitbucket/pulls.ts`
- Create: `src/lib/bitbucket/pulls.test.ts`

**Interfaces:**
- Consumes: `BITBUCKET_API`, `FetchFn`, `fetchAllPages`, `bitbucketGet` (Task 5); types (Task 2).
- Produces:
  - `type RawActivity` (exported for tests)
  - `deriveReadyForReview(createdOn: string, activity: RawActivity[]): { readyForReviewOn: string; readyIsFallback: boolean }`
  - `extractApprovals(repoSlug: string, prId: number, activity: RawActivity[]): ApprovalRecord[]`
  - `fetchPullRequestsUpdatedSince(workspace: string, repoSlug: string, sinceIso: string, auth: string, fetchFn?: FetchFn): Promise<Omit<PullRequestRecord, "readyForReviewOn" | "readyIsFallback">[]>`
  - `fetchPullRequestActivity(workspace: string, repoSlug: string, prId: number, auth: string, fetchFn?: FetchFn): Promise<RawActivity[]>`

- [ ] **Step 1: Write failing tests for the pure parsers**

Create `src/lib/bitbucket/pulls.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  deriveReadyForReview, extractApprovals, fetchPullRequestsUpdatedSince, type RawActivity,
} from "@/lib/bitbucket/pulls";

describe("deriveReadyForReview", () => {
  it("uses the draft-removed update timestamp when present", () => {
    const activity: RawActivity[] = [
      { update: { date: "2026-01-03T00:00:00.000Z", draft: false } },
      { approval: { date: "2026-01-04T00:00:00.000Z", user: { account_id: "u2" } } },
    ];
    const r = deriveReadyForReview("2026-01-01T00:00:00.000Z", activity);
    expect(r).toEqual({ readyForReviewOn: "2026-01-03T00:00:00.000Z", readyIsFallback: false });
  });

  it("falls back to createdOn when no draft transition is recorded", () => {
    const activity: RawActivity[] = [
      { approval: { date: "2026-01-04T00:00:00.000Z", user: { account_id: "u2" } } },
    ];
    const r = deriveReadyForReview("2026-01-01T00:00:00.000Z", activity);
    expect(r).toEqual({ readyForReviewOn: "2026-01-01T00:00:00.000Z", readyIsFallback: true });
  });
});

describe("extractApprovals", () => {
  it("returns one record per approval activity entry", () => {
    const activity: RawActivity[] = [
      { approval: { date: "2026-01-04T00:00:00.000Z", user: { account_id: "u2" } } },
      { update: { date: "2026-01-03T00:00:00.000Z" } },
      { approval: { date: "2026-01-05T00:00:00.000Z", user: { account_id: "u3" } } },
    ];
    expect(extractApprovals("repo-a", 1, activity)).toEqual([
      { repoSlug: "repo-a", prId: 1, approverAccountId: "u2", approvedOn: "2026-01-04T00:00:00.000Z" },
      { repoSlug: "repo-a", prId: 1, approverAccountId: "u3", approvedOn: "2026-01-05T00:00:00.000Z" },
    ]);
  });
});

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, statusText: "OK", json: async () => body }) as Response;

describe("fetchPullRequestsUpdatedSince", () => {
  it("maps PR fields and scopes the query by updated_on", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        values: [{
          id: 5, title: "Add thing", state: "MERGED",
          created_on: "2026-01-01T00:00:00.000Z", updated_on: "2026-01-02T00:00:00.000Z",
          author: { account_id: "u1" },
          destination: { branch: { name: "main" } },
          links: { html: { href: "https://x/5" } },
        }],
      }),
    );
    const prs = await fetchPullRequestsUpdatedSince(
      "ws", "repo-a", "2025-12-01T00:00:00.000Z", "auth", fetchFn as unknown as typeof fetch,
    );
    expect(prs[0]).toMatchObject({
      id: 5, repoSlug: "repo-a", authorAccountId: "u1", title: "Add thing",
      state: "MERGED", destinationBranch: "main", url: "https://x/5", mergedOn: null,
    });
    const url = fetchFn.mock.calls[0][0] as string;
    expect(decodeURIComponent(url)).toContain('updated_on>="2025-12-01T00:00:00.000Z"');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- src/lib/bitbucket/pulls.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/bitbucket/pulls.ts`**

```ts
import { BITBUCKET_API, bitbucketGet, fetchAllPages, type FetchFn } from "./client";
import type { ApprovalRecord, PullRequestRecord, PullRequestState } from "@/types";

export type RawActivity = {
  approval?: { date: string; user: { account_id: string } };
  update?: { date: string; draft?: boolean };
};

type RawPr = {
  id: number;
  title: string;
  state: string;
  created_on: string;
  updated_on: string;
  author: { account_id: string };
  destination: { branch: { name: string } };
  links: { html: { href: string } };
};

// Earliest activity update that marks the PR non-draft = when it became ready for review.
export const deriveReadyForReview = (
  createdOn: string,
  activity: RawActivity[],
): { readyForReviewOn: string; readyIsFallback: boolean } => {
  const readyDates = activity
    .filter((a) => a.update && a.update.draft === false)
    .map((a) => a.update!.date)
    .sort();
  if (readyDates.length > 0) {
    return { readyForReviewOn: readyDates[0], readyIsFallback: false };
  }
  return { readyForReviewOn: createdOn, readyIsFallback: true };
};

export const extractApprovals = (
  repoSlug: string,
  prId: number,
  activity: RawActivity[],
): ApprovalRecord[] =>
  activity
    .filter((a) => a.approval)
    .map((a) => ({
      repoSlug,
      prId,
      approverAccountId: a.approval!.user.account_id,
      approvedOn: a.approval!.date ?? null,
    }));

export const fetchPullRequestsUpdatedSince = async (
  workspace: string,
  repoSlug: string,
  sinceIso: string,
  auth: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<Omit<PullRequestRecord, "readyForReviewOn" | "readyIsFallback">[]> => {
  const states = "state=MERGED&state=OPEN&state=DECLINED&state=SUPERSEDED";
  const q = encodeURIComponent(`updated_on>="${sinceIso}"`);
  const fields = "fields=values.id,values.title,values.state,values.created_on,values.updated_on," +
    "values.author.account_id,values.destination.branch.name,values.links.html.href,next";
  const url = `${BITBUCKET_API}/repositories/${workspace}/${repoSlug}/pullrequests?${states}&q=${q}&pagelen=50&${fields}`;
  const raw = await fetchAllPages<RawPr>(url, auth, fetchFn);
  return raw.map((p) => ({
    id: p.id,
    repoSlug,
    authorAccountId: p.author.account_id,
    title: p.title,
    state: p.state as PullRequestState,
    createdOn: p.created_on,
    mergedOn: p.state === "MERGED" ? p.updated_on : null,
    destinationBranch: p.destination.branch.name,
    url: p.links.html.href,
  }));
};

export const fetchPullRequestActivity = async (
  workspace: string,
  repoSlug: string,
  prId: number,
  auth: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<RawActivity[]> => {
  const url = `${BITBUCKET_API}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/activity?pagelen=50`;
  return fetchAllPages<RawActivity>(url, auth, fetchFn);
};
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- src/lib/bitbucket/pulls.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Validate the activity-payload shape against the real API (the spec's known risk)**

The `RawActivity` shape (`update.draft === false` for the ready transition, and `merged_on` derived from a MERGED PR's `updated_on`) is an assumption that MUST be checked against real Bitbucket data before trusting the leaderboard.

Create a throwaway script `scripts/probe-activity.mjs` (do NOT commit it):

```js
// Usage: BITBUCKET_EMAIL=... BITBUCKET_API_TOKEN=... node scripts/probe-activity.mjs <workspace> <repo> <prId>
const [, , ws, repo, prId] = process.argv;
const auth = "Basic " + Buffer.from(`${process.env.BITBUCKET_EMAIL}:${process.env.BITBUCKET_API_TOKEN}`).toString("base64");
const res = await fetch(`https://api.bitbucket.org/2.0/repositories/${ws}/${repo}/pullrequests/${prId}/activity?pagelen=50`, { headers: { Authorization: auth } });
console.log(JSON.stringify(await res.json(), null, 2));
```

Run it against a recently-merged PR that you know was opened as a draft:

```bash
node scripts/probe-activity.mjs <workspace> <repo> <prId>
```

Inspect the JSON. Confirm whether the draft-removed event appears as `update.draft === false`. If the real shape differs (e.g. the field is named differently or the event is absent), update `deriveReadyForReview` AND its test in this task to match the real payload, then re-run Step 4. Delete the probe script when done (`rm scripts/probe-activity.mjs`). If your team does not use drafts at all, the fallback path (created→merged) is correct as-is — record that finding in the commit message.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bitbucket/pulls.ts src/lib/bitbucket/pulls.test.ts
git commit -m "feat: add bitbucket PR fetch with draft and approval parsing"
```

---

## Task 8: Sync orchestration

**Files:**
- Create: `src/lib/sync/sync.ts`
- Create: `src/lib/sync/sync.test.ts`

**Interfaces:**
- Consumes: db queries (Task 4); `fetchPullRequestsUpdatedSince`, `fetchPullRequestActivity`, `deriveReadyForReview`, `extractApprovals` (Task 7); `window` (Task 1).
- Produces:
  - `type SyncDeps = { db; workspace; auth; fetchPRs; fetchActivity }` (the two fetchers are injected for testing)
  - `syncRepo(deps: SyncDeps, repoSlug: string, nowIso: string): Promise<{ repoSlug: string; prCount: number }>`
  - `syncAll(deps: SyncDeps, repoSlugs: string[], nowIso: string): Promise<{ repos: { repoSlug: string; prCount: number }[]; totalPrs: number }>`

- [ ] **Step 1: Write failing tests**

Create `src/lib/sync/sync.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "@/lib/db/schema";
import { getPullRequests, getApprovals, getLastSynced, setLastSynced } from "@/lib/db/queries";
import { syncRepo, type SyncDeps } from "@/lib/sync/sync";

const freshDb = () => { const db = new Database(":memory:"); applySchema(db); return db; };

const basePr = {
  id: 5, repoSlug: "repo-a", authorAccountId: "u1", title: "T", state: "MERGED" as const,
  createdOn: "2026-01-01T00:00:00.000Z", mergedOn: "2026-01-05T00:00:00.000Z",
  destinationBranch: "main", url: "https://x/5",
};

describe("syncRepo", () => {
  it("persists PRs with derived ready time and their approvals, and advances sync_state", async () => {
    const db = freshDb();
    const deps: SyncDeps = {
      db, workspace: "ws", auth: "auth",
      fetchPRs: vi.fn().mockResolvedValue([basePr]),
      fetchActivity: vi.fn().mockResolvedValue([
        { update: { date: "2026-01-02T00:00:00.000Z", draft: false } },
        { approval: { date: "2026-01-04T00:00:00.000Z", user: { account_id: "u2" } } },
      ]),
    };
    const result = await syncRepo(deps, "repo-a", "2026-06-24T00:00:00.000Z");

    expect(result).toEqual({ repoSlug: "repo-a", prCount: 1 });
    const prs = getPullRequests(db);
    expect(prs[0].readyForReviewOn).toBe("2026-01-02T00:00:00.000Z");
    expect(prs[0].readyIsFallback).toBe(false);
    expect(getApprovals(db).map((a) => a.approverAccountId)).toEqual(["u2"]);
    expect(getLastSynced(db, "repo-a")).toBe("2026-06-24T00:00:00.000Z");
    db.close();
  });

  it("uses the stored last_synced_on as the since cursor, falling back to 6 months when unset", async () => {
    const db = freshDb();
    const fetchPRs = vi.fn().mockResolvedValue([]);
    const deps: SyncDeps = { db, workspace: "ws", auth: "auth", fetchPRs, fetchActivity: vi.fn() };

    await syncRepo(deps, "repo-a", "2026-06-24T00:00:00.000Z");
    expect(fetchPRs.mock.calls[0][2]).toBe("2025-12-24T00:00:00.000Z"); // 6 months before now

    setLastSynced(db, "repo-a", "2026-06-01T00:00:00.000Z");
    await syncRepo(deps, "repo-a", "2026-06-24T00:00:00.000Z");
    expect(fetchPRs.mock.calls[1][2]).toBe("2026-06-01T00:00:00.000Z"); // stored cursor
    db.close();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- src/lib/sync/sync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/sync/sync.ts`**

```ts
import type Database from "better-sqlite3";
import type { PullRequestRecord } from "@/types";
import { upsertPullRequest, replaceApprovals, getLastSynced, setLastSynced } from "@/lib/db/queries";
import {
  deriveReadyForReview, extractApprovals,
  fetchPullRequestsUpdatedSince, fetchPullRequestActivity,
} from "@/lib/bitbucket/pulls";
import { sixMonthsAgoIso } from "@/lib/window";

export type SyncDeps = {
  db: Database.Database;
  workspace: string;
  auth: string;
  fetchPRs: typeof fetchPullRequestsUpdatedSince;
  fetchActivity: typeof fetchPullRequestActivity;
};

export const syncRepo = async (
  deps: SyncDeps,
  repoSlug: string,
  nowIso: string,
): Promise<{ repoSlug: string; prCount: number }> => {
  const since = getLastSynced(deps.db, repoSlug) ?? sixMonthsAgoIso(nowIso);
  const partials = await deps.fetchPRs(deps.workspace, repoSlug, since, deps.auth);

  for (const partial of partials) {
    const activity = await deps.fetchActivity(deps.workspace, repoSlug, partial.id, deps.auth);
    const { readyForReviewOn, readyIsFallback } = deriveReadyForReview(partial.createdOn, activity);
    const pr: PullRequestRecord = { ...partial, readyForReviewOn, readyIsFallback };
    upsertPullRequest(deps.db, pr);
    replaceApprovals(deps.db, repoSlug, partial.id, extractApprovals(repoSlug, partial.id, activity));
  }

  setLastSynced(deps.db, repoSlug, nowIso);
  return { repoSlug, prCount: partials.length };
};

export const syncAll = async (
  deps: SyncDeps,
  repoSlugs: string[],
  nowIso: string,
): Promise<{ repos: { repoSlug: string; prCount: number }[]; totalPrs: number }> => {
  const repos: { repoSlug: string; prCount: number }[] = [];
  for (const slug of repoSlugs) {
    repos.push(await syncRepo(deps, slug, nowIso));
  }
  return { repos, totalPrs: repos.reduce((sum, r) => sum + r.prCount, 0) };
};
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- src/lib/sync/sync.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync/sync.ts src/lib/sync/sync.test.ts
git commit -m "feat: add incremental sync orchestration"
```

---

## Task 9: Analytics — review duration and leaderboard

**Files:**
- Create: `src/lib/analytics/duration.ts`, `src/lib/analytics/duration.test.ts`
- Create: `src/lib/analytics/leaderboard.ts`, `src/lib/analytics/leaderboard.test.ts`

**Interfaces:**
- Consumes: types (Task 2).
- Produces:
  - `reviewDurationMs(pr: { readyForReviewOn: string; mergedOn: string | null }): number | null`
  - `computeLeaderboard(prs: PullRequestRecord[], repos: RepoRecord[], users: UserRecord[], sinceIso: string): LeaderboardRow[]`

- [ ] **Step 1: Write failing test for `reviewDurationMs`**

Create `src/lib/analytics/duration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { reviewDurationMs } from "@/lib/analytics/duration";

describe("reviewDurationMs", () => {
  it("returns the millisecond gap between ready and merge", () => {
    expect(reviewDurationMs({
      readyForReviewOn: "2026-01-01T00:00:00.000Z",
      mergedOn: "2026-01-02T00:00:00.000Z",
    })).toBe(86_400_000);
  });

  it("returns null when the PR is not merged", () => {
    expect(reviewDurationMs({ readyForReviewOn: "2026-01-01T00:00:00.000Z", mergedOn: null })).toBeNull();
  });

  it("clamps negative durations (merge before ready) to 0", () => {
    expect(reviewDurationMs({
      readyForReviewOn: "2026-01-02T00:00:00.000Z",
      mergedOn: "2026-01-01T00:00:00.000Z",
    })).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npm test -- src/lib/analytics/duration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/analytics/duration.ts`**

```ts
export const reviewDurationMs = (
  pr: { readyForReviewOn: string; mergedOn: string | null },
): number | null => {
  if (!pr.mergedOn) return null;
  const ms = new Date(pr.mergedOn).getTime() - new Date(pr.readyForReviewOn).getTime();
  return ms < 0 ? 0 : ms;
};
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npm test -- src/lib/analytics/duration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write failing test for `computeLeaderboard`**

Create `src/lib/analytics/leaderboard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeLeaderboard } from "@/lib/analytics/leaderboard";
import type { PullRequestRecord, RepoRecord, UserRecord } from "@/types";

const repos: RepoRecord[] = [
  { slug: "repo-a", name: "Repo A", projectKey: null, mainBranch: "main", included: true },
];
const users: UserRecord[] = [
  { accountId: "u1", displayName: "Alice", included: true },
  { accountId: "u2", displayName: "Bob", included: true },
  { accountId: "u3", displayName: "Excluded", included: false },
];

const pr = (over: Partial<PullRequestRecord>): PullRequestRecord => ({
  id: 1, repoSlug: "repo-a", authorAccountId: "u1", title: "T", state: "MERGED",
  createdOn: "2026-02-01T00:00:00.000Z", readyForReviewOn: "2026-02-01T00:00:00.000Z",
  readyIsFallback: false, mergedOn: "2026-02-02T00:00:00.000Z",
  destinationBranch: "main", url: "https://x/1", ...over,
});

const SINCE = "2026-01-01T00:00:00.000Z";

describe("computeLeaderboard", () => {
  it("averages each author's merged-to-main PR review times and sorts fastest-first", () => {
    const prs = [
      pr({ id: 1, authorAccountId: "u1", readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-02T00:00:00.000Z" }), // 1d
      pr({ id: 2, authorAccountId: "u1", readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-04T00:00:00.000Z" }), // 3d -> avg 2d
      pr({ id: 3, authorAccountId: "u2", readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-02T12:00:00.000Z" }), // 1.5d
    ];
    const board = computeLeaderboard(prs, repos, users, SINCE);
    expect(board.map((r) => r.displayName)).toEqual(["Bob", "Alice"]); // Bob 1.5d < Alice 2d
    expect(board[1].prCount).toBe(2);
    expect(board[1].averageReviewMs).toBe(2 * 86_400_000);
  });

  it("excludes non-merged, non-main, out-of-window PRs and excluded users", () => {
    const prs = [
      pr({ id: 1, authorAccountId: "u1" }),
      pr({ id: 2, authorAccountId: "u1", state: "OPEN", mergedOn: null }),       // not merged
      pr({ id: 3, authorAccountId: "u1", destinationBranch: "feature" }),        // not main
      pr({ id: 4, authorAccountId: "u1", mergedOn: "2025-06-01T00:00:00.000Z" }), // before window
      pr({ id: 5, authorAccountId: "u3" }),                                       // excluded user
    ];
    const board = computeLeaderboard(prs, repos, users, SINCE);
    expect(board).toHaveLength(1);
    expect(board[0].displayName).toBe("Alice");
    expect(board[0].prCount).toBe(1);
  });

  it("sorts each author's PR list slowest-first and flags fallbacks", () => {
    const prs = [
      pr({ id: 1, readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-02T00:00:00.000Z", readyIsFallback: false }),
      pr({ id: 2, readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-05T00:00:00.000Z", readyIsFallback: true }),
    ];
    const [alice] = computeLeaderboard(prs, repos, users, SINCE);
    expect(alice.prs.map((p) => p.id)).toEqual([2, 1]); // slowest first
    expect(alice.prs[0].readyIsFallback).toBe(true);
  });
});
```

- [ ] **Step 6: Run and confirm it fails**

Run: `npm test -- src/lib/analytics/leaderboard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `src/lib/analytics/leaderboard.ts`**

```ts
import type { LeaderboardRow, LeaderboardPR, PullRequestRecord, RepoRecord, UserRecord } from "@/types";
import { reviewDurationMs } from "./duration";

export const computeLeaderboard = (
  prs: PullRequestRecord[],
  repos: RepoRecord[],
  users: UserRecord[],
  sinceIso: string,
): LeaderboardRow[] => {
  const mainBranchBySlug = new Map(repos.map((r) => [r.slug, r.mainBranch]));
  const includedUsers = users.filter((u) => u.included);
  const nameByAccount = new Map(includedUsers.map((u) => [u.accountId, u.displayName]));

  const eligible = prs.filter(
    (pr) =>
      pr.state === "MERGED" &&
      pr.mergedOn !== null &&
      pr.mergedOn >= sinceIso &&
      pr.destinationBranch === mainBranchBySlug.get(pr.repoSlug) &&
      nameByAccount.has(pr.authorAccountId),
  );

  const byAuthor = new Map<string, LeaderboardPR[]>();
  for (const pr of eligible) {
    const ms = reviewDurationMs(pr);
    if (ms === null) continue;
    const item: LeaderboardPR = {
      id: pr.id, repoSlug: pr.repoSlug, title: pr.title, url: pr.url,
      reviewMs: ms, readyIsFallback: pr.readyIsFallback,
    };
    const list = byAuthor.get(pr.authorAccountId) ?? [];
    list.push(item);
    byAuthor.set(pr.authorAccountId, list);
  }

  const rows: LeaderboardRow[] = [];
  for (const [accountId, items] of byAuthor) {
    const total = items.reduce((s, p) => s + p.reviewMs, 0);
    items.sort((a, b) => b.reviewMs - a.reviewMs); // slowest first within the row
    rows.push({
      accountId,
      displayName: nameByAccount.get(accountId) ?? accountId,
      prCount: items.length,
      averageReviewMs: Math.round(total / items.length),
      prs: items,
    });
  }

  rows.sort((a, b) => a.averageReviewMs - b.averageReviewMs); // fastest first
  return rows;
};
```

- [ ] **Step 8: Run and confirm it passes**

Run: `npm test -- src/lib/analytics/leaderboard.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add src/lib/analytics/duration.ts src/lib/analytics/duration.test.ts src/lib/analytics/leaderboard.ts src/lib/analytics/leaderboard.test.ts
git commit -m "feat: add review-duration and leaderboard analytics"
```

---

## Task 10: Analytics — PRs-created and approval matrices

**Files:**
- Create: `src/lib/analytics/matrices.ts`, `src/lib/analytics/matrices.test.ts`

**Interfaces:**
- Consumes: types (Task 2).
- Produces:
  - `computePrsCreatedMatrix(prs: PullRequestRecord[], repos: RepoRecord[], users: UserRecord[], sinceIso: string): Matrix`
  - `computeApprovalMatrix(prs: PullRequestRecord[], approvals: ApprovalRecord[], users: UserRecord[], sinceIso: string): Matrix`

- [ ] **Step 1: Write failing tests**

Create `src/lib/analytics/matrices.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computePrsCreatedMatrix, computeApprovalMatrix } from "@/lib/analytics/matrices";
import type { PullRequestRecord, ApprovalRecord, RepoRecord, UserRecord } from "@/types";

const users: UserRecord[] = [
  { accountId: "u1", displayName: "Alice", included: true },
  { accountId: "u2", displayName: "Bob", included: true },
  { accountId: "u3", displayName: "Excluded", included: false },
];
const repos: RepoRecord[] = [
  { slug: "repo-a", name: "Repo A", projectKey: null, mainBranch: "main", included: true },
  { slug: "repo-b", name: "Repo B", projectKey: null, mainBranch: "main", included: true },
  { slug: "repo-x", name: "Repo X", projectKey: null, mainBranch: "main", included: false },
];
const SINCE = "2026-01-01T00:00:00.000Z";

const pr = (over: Partial<PullRequestRecord>): PullRequestRecord => ({
  id: 1, repoSlug: "repo-a", authorAccountId: "u1", title: "T", state: "MERGED",
  createdOn: "2026-02-01T00:00:00.000Z", readyForReviewOn: "2026-02-01T00:00:00.000Z",
  readyIsFallback: false, mergedOn: "2026-02-02T00:00:00.000Z",
  destinationBranch: "main", url: "https://x/1", ...over,
});

describe("computePrsCreatedMatrix", () => {
  it("counts PRs created per included user per included repo, with totals", () => {
    const prs = [
      pr({ id: 1, authorAccountId: "u1", repoSlug: "repo-a" }),
      pr({ id: 2, authorAccountId: "u1", repoSlug: "repo-b" }),
      pr({ id: 3, authorAccountId: "u2", repoSlug: "repo-a" }),
      pr({ id: 4, authorAccountId: "u1", repoSlug: "repo-x" }),                    // excluded repo
      pr({ id: 5, authorAccountId: "u3", repoSlug: "repo-a" }),                    // excluded user
      pr({ id: 6, authorAccountId: "u1", repoSlug: "repo-a", createdOn: "2025-06-01T00:00:00.000Z" }), // out of window
    ];
    const m = computePrsCreatedMatrix(prs, repos, users, SINCE);
    expect(m.rowUsers.map((u) => u.displayName)).toEqual(["Alice", "Bob"]);
    expect(m.colHeaders.map((c) => c.label)).toEqual(["Repo A", "Repo B"]);
    expect(m.cells).toEqual([[1, 1], [1, 0]]);
    expect(m.rowTotals).toEqual([2, 1]);
    expect(m.colTotals).toEqual([2, 1]);
  });
});

describe("computeApprovalMatrix", () => {
  it("counts how often each author's PRs were approved by each approver, excluding self-approval", () => {
    const prs = [
      pr({ id: 1, authorAccountId: "u1" }),
      pr({ id: 2, authorAccountId: "u2" }),
    ];
    const approvals: ApprovalRecord[] = [
      { repoSlug: "repo-a", prId: 1, approverAccountId: "u2", approvedOn: null }, // Bob approved Alice's PR1
      { repoSlug: "repo-a", prId: 1, approverAccountId: "u1", approvedOn: null }, // self-approval -> ignored
      { repoSlug: "repo-a", prId: 2, approverAccountId: "u1", approvedOn: null }, // Alice approved Bob's PR2
    ];
    const m = computeApprovalMatrix(prs, approvals, users, SINCE);
    // rows = authors, cols = approvers (both included users)
    expect(m.rowUsers.map((u) => u.displayName)).toEqual(["Alice", "Bob"]);
    expect(m.colHeaders.map((c) => c.label)).toEqual(["Alice", "Bob"]);
    // Alice(row) approved-by Bob(col) = 1; Bob(row) approved-by Alice(col) = 1; diagonal 0
    expect(m.cells).toEqual([[0, 1], [1, 0]]);
    expect(m.rowTotals).toEqual([1, 1]);
    expect(m.colTotals).toEqual([1, 1]);
  });
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npm test -- src/lib/analytics/matrices.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/analytics/matrices.ts`**

```ts
import type { Matrix, PullRequestRecord, ApprovalRecord, RepoRecord, UserRecord } from "@/types";

const zeros = (rows: number, cols: number): number[][] =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));

const withTotals = (
  rowUsers: { accountId: string; displayName: string }[],
  colHeaders: { key: string; label: string }[],
  cells: number[][],
): Matrix => ({
  rowUsers,
  colHeaders,
  cells,
  rowTotals: cells.map((row) => row.reduce((s, n) => s + n, 0)),
  colTotals: colHeaders.map((_, c) => cells.reduce((s, row) => s + row[c], 0)),
});

export const computePrsCreatedMatrix = (
  prs: PullRequestRecord[],
  repos: RepoRecord[],
  users: UserRecord[],
  sinceIso: string,
): Matrix => {
  const rowUsers = users.filter((u) => u.included).map((u) => ({ accountId: u.accountId, displayName: u.displayName }));
  const cols = repos.filter((r) => r.included);
  const colHeaders = cols.map((r) => ({ key: r.slug, label: r.name }));
  const rowIndex = new Map(rowUsers.map((u, i) => [u.accountId, i]));
  const colIndex = new Map(cols.map((r, i) => [r.slug, i]));
  const cells = zeros(rowUsers.length, cols.length);

  for (const pr of prs) {
    if (pr.createdOn < sinceIso) continue;
    const r = rowIndex.get(pr.authorAccountId);
    const c = colIndex.get(pr.repoSlug);
    if (r === undefined || c === undefined) continue;
    cells[r][c] += 1;
  }
  return withTotals(rowUsers, colHeaders, cells);
};

export const computeApprovalMatrix = (
  prs: PullRequestRecord[],
  approvals: ApprovalRecord[],
  users: UserRecord[],
  sinceIso: string,
): Matrix => {
  const included = users.filter((u) => u.included).map((u) => ({ accountId: u.accountId, displayName: u.displayName }));
  const rowUsers = included;
  const colHeaders = included.map((u) => ({ key: u.accountId, label: u.displayName }));
  const rowIndex = new Map(included.map((u, i) => [u.accountId, i]));
  const colIndex = new Map(included.map((u, i) => [u.accountId, i]));
  const cells = zeros(included.length, included.length);

  // author lookup per PR, restricted to in-window PRs
  const authorByKey = new Map<string, string>();
  for (const pr of prs) {
    if (pr.createdOn < sinceIso) continue;
    authorByKey.set(`${pr.repoSlug}#${pr.id}`, pr.authorAccountId);
  }

  for (const a of approvals) {
    const author = authorByKey.get(`${a.repoSlug}#${a.prId}`);
    if (author === undefined) continue;
    if (author === a.approverAccountId) continue; // exclude self-approval
    const r = rowIndex.get(author);
    const c = colIndex.get(a.approverAccountId);
    if (r === undefined || c === undefined) continue;
    cells[r][c] += 1;
  }
  return withTotals(rowUsers, colHeaders, cells);
};
```

- [ ] **Step 4: Run and confirm they pass**

Run: `npm test -- src/lib/analytics/matrices.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/matrices.ts src/lib/analytics/matrices.test.ts
git commit -m "feat: add PRs-created and approval matrix analytics"
```

---

## Task 11: API routes (discover, sync, roster, insights)

**Files:**
- Create: `src/app/api/discover/route.ts`
- Create: `src/app/api/sync/route.ts`
- Create: `src/app/api/roster/route.ts`
- Create: `src/app/api/insights/route.ts`
- Delete: `src/app/api/reviews/route.ts` (legacy; superseded)

**Interfaces:**
- Consumes: everything from Tasks 3–10, `config` (Task 3).
- Produces HTTP endpoints:
  - `POST /api/discover` → `{ users: number; repos: number }`
  - `POST /api/sync` → `{ repos: {repoSlug,prCount}[]; totalPrs: number }`
  - `GET /api/roster` → `{ users: UserRecord[]; repos: RepoRecord[] }`
  - `PATCH /api/roster` body `{ kind: "user"|"repo"; id: string; included: boolean }` → `{ ok: true }`
  - `GET /api/insights` → `InsightsResponse`

- [ ] **Step 1: Implement `src/app/api/discover/route.ts`**

```ts
import { NextResponse } from "next/server";
import { config } from "@/config";
import { getDb } from "@/lib/db";
import { upsertUsers, upsertRepos } from "@/lib/db/queries";
import { getAuthHeader } from "@/lib/bitbucket/client";
import { fetchWorkspaceMembers, fetchRepos } from "@/lib/bitbucket/discover";

export const runtime = "nodejs";

export async function POST() {
  try {
    const auth = getAuthHeader();
    const [members, repos] = await Promise.all([
      fetchWorkspaceMembers(config.workspace, auth),
      fetchRepos(config.workspace, config.projectKey, auth),
    ]);
    const db = getDb();
    upsertUsers(db, members);
    upsertRepos(db, repos);
    return NextResponse.json({ users: members.length, repos: repos.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Implement `src/app/api/sync/route.ts`**

```ts
import { NextResponse } from "next/server";
import { config } from "@/config";
import { getDb } from "@/lib/db";
import { getRepos } from "@/lib/db/queries";
import { getAuthHeader } from "@/lib/bitbucket/client";
import { fetchPullRequestsUpdatedSince, fetchPullRequestActivity } from "@/lib/bitbucket/pulls";
import { syncAll, type SyncDeps } from "@/lib/sync/sync";

export const runtime = "nodejs";

export async function POST() {
  try {
    const auth = getAuthHeader();
    const db = getDb();
    const includedRepos = getRepos(db).filter((r) => r.included).map((r) => r.slug);
    if (includedRepos.length === 0) {
      return NextResponse.json({ error: "No repos selected. Run Discover and include some repos first." }, { status: 400 });
    }
    const deps: SyncDeps = {
      db, workspace: config.workspace, auth,
      fetchPRs: fetchPullRequestsUpdatedSince,
      fetchActivity: fetchPullRequestActivity,
    };
    const summary = await syncAll(deps, includedRepos, new Date().toISOString());
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Implement `src/app/api/roster/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getUsers, getRepos, setUserIncluded, setRepoIncluded } from "@/lib/db/queries";

export const runtime = "nodejs";

export async function GET() {
  const db = getDb();
  return NextResponse.json({ users: getUsers(db), repos: getRepos(db) });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || (body.kind !== "user" && body.kind !== "repo") || typeof body.id !== "string" || typeof body.included !== "boolean") {
    return NextResponse.json({ error: "Expected { kind: 'user'|'repo', id: string, included: boolean }" }, { status: 400 });
  }
  const db = getDb();
  if (body.kind === "user") setUserIncluded(db, body.id, body.included);
  else setRepoIncluded(db, body.id, body.included);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Implement `src/app/api/insights/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getUsers, getRepos, getPullRequests, getApprovals } from "@/lib/db/queries";
import { computeLeaderboard } from "@/lib/analytics/leaderboard";
import { computePrsCreatedMatrix, computeApprovalMatrix } from "@/lib/analytics/matrices";
import { sixMonthsAgoIso } from "@/lib/window";
import type { InsightsResponse } from "@/types";

export const runtime = "nodejs";

export async function GET() {
  const db = getDb();
  const users = getUsers(db);
  const repos = getRepos(db);
  const prs = getPullRequests(db);
  const approvals = getApprovals(db);

  const generatedAt = new Date().toISOString();
  const sinceIso = sixMonthsAgoIso(generatedAt);

  const body: InsightsResponse = {
    leaderboard: computeLeaderboard(prs, repos, users, sinceIso),
    prsCreated: computePrsCreatedMatrix(prs, repos, users, sinceIso),
    approvals: computeApprovalMatrix(prs, approvals, users, sinceIso),
    sinceIso,
    generatedAt,
  };
  return NextResponse.json(body);
}
```

- [ ] **Step 5: Delete the legacy route**

```bash
git rm src/app/api/reviews/route.ts
```

- [ ] **Step 6: Verify type-check and build**

Run: `npx tsc --noEmit`
Expected: no errors. (If `src/lib/bitbucket.ts` legacy file references removed config fields, leave it for Task 13 cleanup — it is not imported by the new routes. If `tsc` errors on it, delete `src/lib/bitbucket.ts`, `src/lib/jira.ts`, `src/components/ReviewTable.tsx`, `src/components/RefreshButton.tsx` now since the new UI replaces them in Task 12.)

- [ ] **Step 7: Commit**

```bash
git add src/app/api
git commit -m "feat: add discover, sync, roster, and insights API routes"
```

---

## Task 12: UI — tab shell, Team tab, Leaderboard tab, Matrix tabs

**Files:**
- Create: `src/components/Tabs.tsx`, `src/components/TeamTab.tsx`, `src/components/LeaderboardTab.tsx`, `src/components/MatrixTable.tsx`, `src/components/MatrixTable.test.tsx`
- Modify: `src/app/page.tsx`, `src/app/layout.tsx`
- Delete (if still present): `src/components/ReviewTable.tsx`, `src/components/RefreshButton.tsx`

**Interfaces:**
- Consumes: `InsightsResponse`, `Matrix`, `UserRecord`, `RepoRecord`, `LeaderboardRow` (Task 2); the API routes (Task 11).
- Produces: client components composing the dashboard.

- [ ] **Step 1: Write a failing test for `MatrixTable`**

Create `src/components/MatrixTable.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MatrixTable from "@/components/MatrixTable";
import type { Matrix } from "@/types";

const matrix: Matrix = {
  rowUsers: [{ accountId: "u1", displayName: "Alice" }],
  colHeaders: [{ key: "repo-a", label: "Repo A" }],
  cells: [[3]],
  rowTotals: [3],
  colTotals: [3],
};

describe("MatrixTable", () => {
  it("renders row labels, column headers, and cell values", () => {
    render(<MatrixTable matrix={matrix} cornerLabel="User \\ Repo" />);
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Repo A")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npm test -- src/components/MatrixTable.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/components/MatrixTable.tsx`**

```tsx
import type { Matrix } from "@/types";

export default function MatrixTable({ matrix, cornerLabel }: { matrix: Matrix; cornerLabel: string }) {
  if (matrix.rowUsers.length === 0 || matrix.colHeaders.length === 0) {
    return <p className="text-sm text-gray-500">No data yet — discover, include users/repos, then refresh.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 bg-gray-100 border px-3 py-2 text-left font-medium text-gray-700">{cornerLabel}</th>
            {matrix.colHeaders.map((c) => (
              <th key={c.key} className="border px-3 py-2 text-gray-700 font-medium whitespace-nowrap">{c.label}</th>
            ))}
            <th className="border px-3 py-2 bg-gray-100 text-gray-700 font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {matrix.rowUsers.map((u, r) => (
            <tr key={u.accountId}>
              <th className="sticky left-0 bg-white border px-3 py-2 text-left font-medium text-gray-700 whitespace-nowrap">{u.displayName}</th>
              {matrix.colHeaders.map((c, ci) => (
                <td key={c.key} className="border px-3 py-2 text-center text-gray-800">
                  {matrix.cells[r][ci] || ""}
                </td>
              ))}
              <td className="border px-3 py-2 text-center font-semibold bg-gray-50">{matrix.rowTotals[r]}</td>
            </tr>
          ))}
          <tr>
            <th className="sticky left-0 bg-gray-100 border px-3 py-2 text-left font-semibold text-gray-700">Total</th>
            {matrix.colTotals.map((t, i) => (
              <td key={i} className="border px-3 py-2 text-center font-semibold bg-gray-50">{t}</td>
            ))}
            <td className="border px-3 py-2" />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npm test -- src/components/MatrixTable.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Implement `src/components/LeaderboardTab.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { LeaderboardRow } from "@/types";

const fmtDuration = (ms: number): string => {
  const hours = ms / 3_600_000;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
};

export default function LeaderboardTab({ rows }: { rows: LeaderboardRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (rows.length === 0) return <p className="text-sm text-gray-500">No merged PRs in the window yet.</p>;

  return (
    <table className="border-collapse text-sm w-full max-w-2xl">
      <thead>
        <tr className="text-left text-gray-700">
          <th className="border px-3 py-2">#</th>
          <th className="border px-3 py-2">Engineer</th>
          <th className="border px-3 py-2">Avg review time</th>
          <th className="border px-3 py-2">PRs</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <FragmentRow
            key={row.accountId}
            row={row}
            rank={i + 1}
            isOpen={open === row.accountId}
            onToggle={() => setOpen(open === row.accountId ? null : row.accountId)}
          />
        ))}
      </tbody>
    </table>
  );
}

function FragmentRow({
  row, rank, isOpen, onToggle,
}: { row: LeaderboardRow; rank: number; isOpen: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-gray-50" onClick={onToggle}>
        <td className="border px-3 py-2">{rank}</td>
        <td className="border px-3 py-2 font-medium text-gray-800">{isOpen ? "▾" : "▸"} {row.displayName}</td>
        <td className="border px-3 py-2">{fmtDuration(row.averageReviewMs)}</td>
        <td className="border px-3 py-2">{row.prCount}</td>
      </tr>
      {isOpen && (
        <tr>
          <td className="border px-3 py-2 bg-gray-50" colSpan={4}>
            <ul className="space-y-1">
              {row.prs.map((pr) => (
                <li key={`${pr.repoSlug}#${pr.id}`} className="flex justify-between gap-4">
                  <a className="text-blue-600 hover:underline truncate" href={pr.url} target="_blank" rel="noreferrer">
                    {pr.repoSlug} #{pr.id} — {pr.title}
                  </a>
                  <span className="whitespace-nowrap text-gray-700">
                    {fmtDuration(pr.reviewMs)}{pr.readyIsFallback ? " *" : ""}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-gray-500">* draft transition unknown — measured from PR creation.</p>
          </td>
        </tr>
      )}
    </>
  );
}
```

- [ ] **Step 6: Implement `src/components/TeamTab.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { UserRecord, RepoRecord } from "@/types";

type Roster = { users: UserRecord[]; repos: RepoRecord[] };

export default function TeamTab({
  roster, onRosterChange,
}: { roster: Roster; onRosterChange: (r: Roster) => void }) {
  const [busy, setBusy] = useState<null | "discover" | "sync">(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadRoster = async () => {
    const res = await fetch("/api/roster");
    onRosterChange(await res.json());
  };

  const run = async (kind: "discover" | "sync") => {
    setBusy(kind); setError(null); setMessage(null);
    try {
      const res = await fetch(`/api/${kind}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Request failed"); return; }
      setMessage(kind === "discover"
        ? `Discovered ${json.users} users, ${json.repos} repos.`
        : `Synced ${json.totalPrs} PRs across ${json.repos.length} repos.`);
      await reloadRoster();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setBusy(null); }
  };

  const toggle = async (kind: "user" | "repo", id: string, included: boolean) => {
    await fetch("/api/roster", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id, included }),
    });
    await reloadRoster();
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-3 items-center">
        <button onClick={() => run("discover")} disabled={busy !== null}
          className="px-4 py-2 rounded bg-gray-800 text-white disabled:opacity-50">
          {busy === "discover" ? "Discovering…" : "Discover workspace"}
        </button>
        <button onClick={() => run("sync")} disabled={busy !== null}
          className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50">
          {busy === "sync" ? "Refreshing…" : "Refresh data"}
        </button>
        {message && <span className="text-sm text-green-700">{message}</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <RosterList title="Engineers" empty="No users yet — run Discover."
          items={roster.users.map((u) => ({ id: u.accountId, label: u.displayName, included: u.included }))}
          onToggle={(id, inc) => toggle("user", id, inc)} />
        <RosterList title="Repositories" empty="No repos yet — run Discover."
          items={roster.repos.map((r) => ({ id: r.slug, label: r.name, included: r.included }))}
          onToggle={(id, inc) => toggle("repo", id, inc)} />
      </div>
    </div>
  );
}

function RosterList({
  title, empty, items, onToggle,
}: {
  title: string; empty: string;
  items: { id: string; label: string; included: boolean }[];
  onToggle: (id: string, included: boolean) => void;
}) {
  return (
    <div>
      <h3 className="font-semibold text-gray-800 mb-2">{title}</h3>
      {items.length === 0 ? <p className="text-sm text-gray-500">{empty}</p> : (
        <ul className="space-y-1">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-2">
              <input type="checkbox" checked={it.included} onChange={(e) => onToggle(it.id, e.target.checked)} />
              <span className="text-sm text-gray-800">{it.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Implement `src/components/Tabs.tsx`**

```tsx
"use client";

export type TabKey = "team" | "leaderboard" | "created" | "approvals";

const TABS: { key: TabKey; label: string }[] = [
  { key: "team", label: "Team" },
  { key: "leaderboard", label: "Review-time leaderboard" },
  { key: "created", label: "PRs created" },
  { key: "approvals", label: "Approvals" },
];

export default function Tabs({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  return (
    <nav className="flex gap-1 border-b mb-6">
      {TABS.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`px-4 py-2 text-sm -mb-px border-b-2 ${
            active === t.key ? "border-blue-600 text-blue-700 font-medium" : "border-transparent text-gray-500 hover:text-gray-700"
          }`}>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 8: Replace `src/app/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import Tabs, { type TabKey } from "@/components/Tabs";
import TeamTab from "@/components/TeamTab";
import LeaderboardTab from "@/components/LeaderboardTab";
import MatrixTable from "@/components/MatrixTable";
import type { InsightsResponse, UserRecord, RepoRecord } from "@/types";

type Roster = { users: UserRecord[]; repos: RepoRecord[] };
const EMPTY_MATRIX = { rowUsers: [], colHeaders: [], cells: [], rowTotals: [], colTotals: [] };

export default function Home() {
  const [tab, setTab] = useState<TabKey>("team");
  const [roster, setRoster] = useState<Roster>({ users: [], repos: [] });
  const [insights, setInsights] = useState<InsightsResponse | null>(null);

  useEffect(() => {
    fetch("/api/roster").then((r) => r.json()).then(setRoster).catch(() => {});
    fetch("/api/insights").then((r) => r.json()).then(setInsights).catch(() => {});
  }, []);

  // Recompute insights whenever the user switches to an analytics tab (cheap; reads local DB).
  useEffect(() => {
    if (tab !== "team") fetch("/api/insights").then((r) => r.json()).then(setInsights).catch(() => {});
  }, [tab]);

  return (
    <main className="min-h-screen bg-white p-8">
      <div className="max-w-screen-xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Argus</h1>
        <p className="text-sm text-gray-500 mb-6">Team PR insights — review times, authorship, and who approves whom (last 6 months).</p>

        <Tabs active={tab} onChange={setTab} />

        {tab === "team" && <TeamTab roster={roster} onRosterChange={setRoster} />}
        {tab === "leaderboard" && <LeaderboardTab rows={insights?.leaderboard ?? []} />}
        {tab === "created" && <MatrixTable matrix={insights?.prsCreated ?? EMPTY_MATRIX} cornerLabel="Engineer \ Project" />}
        {tab === "approvals" && <MatrixTable matrix={insights?.approvals ?? EMPTY_MATRIX} cornerLabel="Author \ Approver" />}
      </div>
    </main>
  );
}
```

- [ ] **Step 9: Update `src/app/layout.tsx` title metadata**

Find the `metadata` export (or the `<title>`); set the title/description to Argus:

```tsx
export const metadata = {
  title: "Argus — Team PR Insights",
  description: "Bitbucket PR review insights for the team.",
};
```

- [ ] **Step 10: Remove superseded legacy components/libs if still present**

```bash
git rm -f src/components/ReviewTable.tsx src/components/RefreshButton.tsx src/lib/bitbucket.ts src/lib/jira.ts 2>/dev/null || true
```

- [ ] **Step 11: Type-check, build, and run the full test suite**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: tsc clean; all vitest tests PASS; Next build succeeds.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: add Argus tabbed UI (team, leaderboard, matrices)"
```

---

## Task 13: Docs, env example, and manual smoke test

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `.env.local.example`

- [ ] **Step 1: Update `.env.local.example`**

```
# Bitbucket API credentials — generate at https://id.atlassian.com/manage-profile/security/api-tokens
# Required permissions: Repositories (Read), Pull requests (Read), Account (Read)
BITBUCKET_EMAIL=your.email@mvfglobal.com
BITBUCKET_API_TOKEN=your_bitbucket_api_token

# Workspace + optional project scoping
BITBUCKET_WORKSPACE=mvfglobal
# BITBUCKET_PROJECT_KEY=PROJ      # optional: limit discovered repos to one project
# ARGUS_DB_PATH=data/argus.sqlite # optional: override the local cache location
```

- [ ] **Step 2: Rewrite `README.md` and `CLAUDE.md`**

Replace their content to describe Argus: stack (Next 16 + SQLite + Bitbucket), the four tabs, the Discover→include→Refresh flow, the metric definitions (ready-for-review → merged, fallback to created), and the setup steps (copy `.env.local.example`, `npm install`, `npm run dev`, click Discover, include users/repos, click Refresh data). Document that data persists in `data/argus.sqlite` and refresh is incremental.

- [ ] **Step 3: Manual smoke test against real Bitbucket**

```bash
cp .env.local.example .env.local   # then edit in real BITBUCKET_EMAIL / BITBUCKET_API_TOKEN / BITBUCKET_WORKSPACE
npm run dev
```

In the browser at http://localhost:3000:
1. Team tab → **Discover workspace** → users and repos populate.
2. Untick repos/users you don't care about.
3. **Refresh data** → wait for the synced summary.
4. Check the **Review-time leaderboard**, **PRs created**, and **Approvals** tabs render with real numbers.
5. Expand a leaderboard row; confirm per-PR durations and that fallback-flagged (`*`) PRs make sense.

Confirm the numbers look plausible. If draft handling is wrong, revisit Task 7 Step 5.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md .env.local.example
git commit -m "docs: document Argus setup, flow, and metrics"
```

---

## Self-Review Notes (plan author)

- **Spec coverage:** colleague table + button → Task 12 TeamTab (Discover/Refresh + roster toggles). Leaderboard (ready→merged, 6 months, merged-to-main, expandable) → Tasks 9 + 12. PRs-created matrix → Tasks 10 + 12. Approval matrix (self excluded) → Tasks 10 + 12. SQLite persistence + incremental refresh → Tasks 3, 4, 8. Auto-discovery → Tasks 6, 11. Draft→ready risk → Task 7 (with real-API validation step). All spec sections map to tasks.
- **Type consistency:** `PullRequestRecord`/`Matrix`/`LeaderboardRow` defined once in Task 2 and consumed unchanged thereafter; the `(repoSlug, id)` composite key is used consistently in schema, queries, sync, and the approval matrix's `repoSlug#id` join key.
- **Placeholders:** none — every code step contains complete code; the only "throwaway" is the explicitly-uncommitted probe script in Task 7.
