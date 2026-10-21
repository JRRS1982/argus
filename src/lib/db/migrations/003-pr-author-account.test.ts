// src/lib/db/migrations/003-pr-author-account.test.ts
// Failure scenario: if the backfill is wrong, undoing a mistaken merge of two Bitbucket
// people moves the wrong pull requests — permanently, because Bitbucket is an archive and
// legacy_pull_requests is the only surviving record of who authored what.
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "@/lib/db/migrations/runner";
import { MIGRATIONS } from "@/lib/db/migrations";

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
    INSERT INTO users VALUES ('u1','Alice',1), ('u2','Bob',1);
    INSERT INTO repos VALUES ('repo-a','Repo A','PROJ','main',1);
  `);
  return db;
};

const pr = (id: number, author: string) =>
  `('repo-a',${id},'${author}','PR ${id}','MERGED','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z',1,'2026-01-05T00:00:00Z','main','https://x/${id}')`;

describe("migration 003 — pull request author account", () => {
  it("backfills every Bitbucket row with the author the legacy table recorded", () => {
    const db = legacy();
    db.exec(`INSERT INTO pull_requests VALUES ${pr(1, "u1")}, ${pr(2, "u2")}, ${pr(3, "u1")}`);

    runMigrations(db, MIGRATIONS);

    expect(db.prepare(
      `SELECT number, author_account_id AS author FROM pull_requests ORDER BY number`,
    ).all()).toEqual([
      { number: 1, author: "u1" },
      { number: 2, author: "u2" },
      { number: 3, author: "u1" },
    ]);
    db.close();
  });

  it("leaves no Bitbucket row unattributed", () => {
    const db = legacy();
    db.exec(`INSERT INTO pull_requests VALUES ${pr(1, "u1")}, ${pr(2, "u2")}`);

    runMigrations(db, MIGRATIONS);

    expect(db.prepare(
      `SELECT COUNT(*) AS c FROM pull_requests WHERE provider = 'bitbucket' AND author_account_id IS NULL`,
    ).get()).toEqual({ c: 0 });
    db.close();
  });

  // The author recorded must be the one who wrote the PR, not merely one of the authors
  // present — a join on the wrong key would still leave zero nulls behind.
  it("agrees with the canonical person each row was assigned", () => {
    const db = legacy();
    db.exec(`INSERT INTO pull_requests VALUES ${pr(1, "u1")}, ${pr(2, "u2")}`);

    runMigrations(db, MIGRATIONS);

    expect(db.prepare(`
      SELECT COUNT(*) AS c FROM pull_requests p
      JOIN person_identities i ON i.provider = 'bitbucket' AND i.account_id = p.author_account_id
      WHERE i.person_id != p.person_id
    `).get()).toEqual({ c: 0 });
    db.close();
  });

  it("adds the column to a fresh database with nothing to backfill", () => {
    const db = new Database(":memory:");
    runMigrations(db, MIGRATIONS);
    expect(db.prepare(`SELECT COUNT(*) AS c FROM pull_requests`).get()).toEqual({ c: 0 });
    expect((db.prepare(`SELECT * FROM pragma_table_info('pull_requests')`).all() as { name: string }[])
      .map((c) => c.name)).toContain("author_account_id");
    db.close();
  });
});
