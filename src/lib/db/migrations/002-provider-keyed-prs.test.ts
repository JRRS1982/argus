// src/lib/db/migrations/002-provider-keyed-prs.test.ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "@/lib/db/migrations/runner";
import { MIGRATIONS } from "@/lib/db/migrations";
import migration001 from "@/lib/db/migrations/001-canonical-entities";

const legacy = () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (account_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, included INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE repos (slug TEXT PRIMARY KEY, name TEXT NOT NULL, project_key TEXT, main_branch TEXT NOT NULL DEFAULT 'main', included INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE pull_requests (
      repo_slug TEXT NOT NULL, id INTEGER NOT NULL, author_account_id TEXT NOT NULL,
      title TEXT NOT NULL, state TEXT NOT NULL, created_on TEXT NOT NULL,
      ready_for_review_on TEXT NOT NULL, ready_is_fallback INTEGER NOT NULL DEFAULT 1,
      merged_on TEXT, destination_branch TEXT NOT NULL, url TEXT NOT NULL,
      PRIMARY KEY (repo_slug, id));
    CREATE TABLE approvals (
      repo_slug TEXT NOT NULL, pr_id INTEGER NOT NULL, approver_account_id TEXT NOT NULL,
      approved_on TEXT, PRIMARY KEY (repo_slug, pr_id, approver_account_id));
    CREATE TABLE sync_state (repo_slug TEXT PRIMARY KEY, last_synced_on TEXT NOT NULL);
    INSERT INTO users VALUES ('u1','Alice',1);
    INSERT INTO repos VALUES ('repo-a','Repo A','PROJ','main',1);
  `);
  return db;
};

const pr = (id: number, author = "u1", fallback = 1) =>
  `('repo-a',${id},'${author}','PR ${id}','MERGED','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z',${fallback},'2026-01-05T00:00:00Z','main','https://x/${id}')`;

// Derived, so a new migration does not invalidate assertions about "fully migrated".
const LATEST = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);

describe("migration 002 — provider-keyed PRs", () => {
  it("preserves every PR, stamped bitbucket, with canonical ids resolved", () => {
    const db = legacy();
    db.exec(`INSERT INTO pull_requests VALUES ${pr(1)}, ${pr(2)}`);
    runMigrations(db, MIGRATIONS);

    const rows = db.prepare(
      `SELECT provider, repo_key, number, service_id, person_id FROM pull_requests ORDER BY number`
    ).all() as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0].provider).toBe("bitbucket");
    expect(rows[0].repo_key).toBe("repo-a");
    expect(rows[0].service_id).toEqual(expect.any(Number));
    expect(rows[0].person_id).toEqual(expect.any(Number));
    db.close();
  });

  // Review Focus 1 again, now at the point where rows would actually be lost.
  it("keeps PRs whose author was never in users", () => {
    const db = legacy();
    db.exec(`INSERT INTO pull_requests VALUES ${pr(1)}, ${pr(2, "ghost")}`);
    runMigrations(db, MIGRATIONS);
    expect(db.prepare(`SELECT COUNT(*) c FROM pull_requests`).get()).toEqual({ c: 2 });
    const ghostPr = db.prepare(
      `SELECT p.display_name FROM pull_requests pr
       JOIN people p ON p.id = pr.person_id WHERE pr.number = 2`).get();
    expect(ghostPr).toEqual({ display_name: "ghost" });
    db.close();
  });

  it("maps ready_is_fallback onto precision, and marks Bitbucket merges derived", () => {
    const db = legacy();
    db.exec(`INSERT INTO pull_requests VALUES ${pr(1, "u1", 1)}, ${pr(2, "u1", 0)}`);
    runMigrations(db, MIGRATIONS);
    const rows = db.prepare(
      `SELECT number, ready_for_review_precision, merged_on_precision
       FROM pull_requests ORDER BY number`).all();
    expect(rows).toEqual([
      { number: 1, ready_for_review_precision: "fallback", merged_on_precision: "derived" },
      { number: 2, ready_for_review_precision: "derived", merged_on_precision: "derived" },
    ]);
    db.close();
  });

  // Review Focus 3 — the collision the old primary key could not survive.
  it("lets the same repo name and PR number coexist on two providers", () => {
    const db = legacy();
    db.exec(`INSERT INTO pull_requests VALUES ${pr(42)}`);
    runMigrations(db, MIGRATIONS);

    const service = db.prepare(`SELECT id FROM services LIMIT 1`).get() as { id: number };
    const person = db.prepare(`SELECT id FROM people LIMIT 1`).get() as { id: number };
    db.prepare(`
      INSERT INTO pull_requests
        (provider, repo_key, number, service_id, person_id, title, state, created_on,
         ready_for_review_on, ready_for_review_precision, merged_on, merged_on_precision,
         destination_branch, url)
      VALUES ('github','repo-a',42,?,?,'Different PR','MERGED','2026-07-01T00:00:00Z',
              '2026-07-01T00:00:00Z','exact','2026-07-02T00:00:00Z','exact','main','https://gh/42')
    `).run(service.id, person.id);

    const both = db.prepare(
      `SELECT provider, title FROM pull_requests WHERE number = 42 ORDER BY provider`).all();
    expect(both).toEqual([
      { provider: "bitbucket", title: "PR 42" },
      { provider: "github", title: "Different PR" },
    ]);
    db.close();
  });

  it("preserves approvals, including from approvers never in users", () => {
    const db = legacy();
    db.exec(`INSERT INTO pull_requests VALUES ${pr(1)}`);
    db.exec(`INSERT INTO approvals VALUES
      ('repo-a',1,'u1','2026-01-03T00:00:00Z'),
      ('repo-a',1,'stranger',NULL)`);
    runMigrations(db, MIGRATIONS);
    const rows = db.prepare(
      `SELECT provider, repo_key, pr_number, approver_account_id, approved_on
       FROM approvals ORDER BY approver_account_id`).all();
    expect(rows).toEqual([
      { provider: "bitbucket", repo_key: "repo-a", pr_number: 1, approver_account_id: "stranger", approved_on: null },
      { provider: "bitbucket", repo_key: "repo-a", pr_number: 1, approver_account_id: "u1", approved_on: "2026-01-03T00:00:00Z" },
    ]);
    db.close();
  });

  it("keeps the original rows on disk under legacy_ names", () => {
    const db = legacy();
    db.exec(`INSERT INTO pull_requests VALUES ${pr(1)}`);
    db.exec(`INSERT INTO approvals VALUES ('repo-a',1,'u1','2026-01-03T00:00:00Z')`);
    runMigrations(db, MIGRATIONS);
    expect(db.prepare(`SELECT COUNT(*) c FROM legacy_pull_requests`).get()).toEqual({ c: 1 });
    expect(db.prepare(`SELECT title FROM legacy_pull_requests`).get()).toEqual({ title: "PR 1" });
    expect(db.prepare(`SELECT COUNT(*) c FROM legacy_approvals`).get()).toEqual({ c: 1 });
    expect(db.prepare(`SELECT approved_on FROM legacy_approvals`).get())
      .toEqual({ approved_on: "2026-01-03T00:00:00Z" });
    db.close();
  });

  // Idempotency comes from the runner's version gate, not from up() being re-runnable:
  // up() is not, because its RENAME would fail on a second call.
  it("is idempotent across a second run", () => {
    const db = legacy();
    db.exec(`INSERT INTO pull_requests VALUES ${pr(1)}`);
    db.exec(`INSERT INTO approvals VALUES ('repo-a',1,'u1','2026-01-03T00:00:00Z')`);
    runMigrations(db, MIGRATIONS);
    runMigrations(db, MIGRATIONS);
    expect(db.pragma("user_version", { simple: true })).toBe(LATEST);
    expect(db.prepare(`SELECT COUNT(*) c FROM pull_requests`).get()).toEqual({ c: 1 });
    expect(db.prepare(`SELECT title FROM pull_requests`).get()).toEqual({ title: "PR 1" });
    expect(db.prepare(`SELECT COUNT(*) c FROM legacy_pull_requests`).get()).toEqual({ c: 1 });
    expect(db.prepare(`SELECT COUNT(*) c FROM legacy_approvals`).get()).toEqual({ c: 1 });
    db.close();
  });

  it("reaches the latest version on an empty database with both rebuilt tables empty", () => {
    const db = new Database(":memory:");
    runMigrations(db, MIGRATIONS);
    expect(db.pragma("user_version", { simple: true })).toBe(LATEST);
    expect(db.prepare(`SELECT COUNT(*) c FROM pull_requests`).get()).toEqual({ c: 0 });
    expect(db.prepare(`SELECT COUNT(*) c FROM approvals`).get()).toEqual({ c: 0 });
    db.close();
  });

  // End-to-end proof the safety net fires on THIS migration: break identity coverage
  // after 001 and 002 must roll back entirely rather than silently drop the PR.
  it("rolls back entirely when identity coverage is broken, losing no rows", () => {
    const db = legacy();
    db.exec(`INSERT INTO pull_requests VALUES ${pr(1)}, ${pr(2, "u1")}`);
    runMigrations(db, [migration001]);
    expect(db.pragma("user_version", { simple: true })).toBe(1);
    db.exec(`DELETE FROM person_identities WHERE account_id = 'u1'`);

    expect(() => runMigrations(db, MIGRATIONS)).toThrow(/row count/);

    expect(db.pragma("user_version", { simple: true })).toBe(1);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'legacy_pull_requests'`).get())
      .toBeUndefined();
    const rows = db.prepare(`SELECT repo_slug, id, title FROM pull_requests ORDER BY id`).all();
    expect(rows).toEqual([
      { repo_slug: "repo-a", id: 1, title: "PR 1" },
      { repo_slug: "repo-a", id: 2, title: "PR 2" },
    ]);
    db.close();
  });
});
