// src/lib/db/migrations/001-canonical-entities.test.ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "@/lib/db/migrations/runner";
import migration001 from "@/lib/db/migrations/001-canonical-entities";

// The pre-migration schema, verbatim, so the test exercises a real upgrade.
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
  `);
  return db;
};

const run = (db: Database.Database) => runMigrations(db, [migration001]);

describe("migration 001 — canonical entities", () => {
  it("creates one person per discovered user, carrying the include flag across", () => {
    const db = legacy();
    db.exec(`INSERT INTO users VALUES ('u1','Alice',1), ('u2','Bob',0)`);
    run(db);
    const people = db.prepare(`SELECT display_name, included FROM people ORDER BY display_name`).all();
    expect(people).toEqual([{ display_name: "Alice", included: 1 }, { display_name: "Bob", included: 0 }]);
    db.close();
  });

  // The 56.6% case: most historical authors were never discovered into users.
  it("creates a person for a PR author who was never discovered into users", () => {
    const db = legacy();
    db.exec(`INSERT INTO users VALUES ('u1','Alice',1)`);
    db.exec(`INSERT INTO repos VALUES ('repo-a','Repo A',NULL,'main',1)`);
    db.exec(`INSERT INTO pull_requests VALUES
      ('repo-a',1,'u1','PR1','MERGED','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',1,NULL,'main','https://x/1'),
      ('repo-a',2,'ghost','PR2','MERGED','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',1,NULL,'main','https://x/2')`);
    run(db);

    const ids = db.prepare(`SELECT account_id FROM person_identities ORDER BY account_id`).all();
    expect(ids).toEqual([{ account_id: "ghost" }, { account_id: "u1" }]);
    // An undiscovered author is excluded and named by their account id — there is
    // no display name to use, and ticking them must stay a deliberate act.
    const ghost = db.prepare(
      `SELECT p.display_name, p.included FROM people p
       JOIN person_identities i ON i.person_id = p.id WHERE i.account_id = 'ghost'`).get();
    expect(ghost).toEqual({ display_name: "ghost", included: 0 });
    db.close();
  });

  it("creates a person for an approver who is in no other table", () => {
    const db = legacy();
    db.exec(`INSERT INTO approvals VALUES ('repo-a',1,'reviewer-x','2026-01-02T00:00:00Z')`);
    run(db);
    expect(db.prepare(`SELECT COUNT(*) c FROM person_identities WHERE account_id='reviewer-x'`).get())
      .toEqual({ c: 1 });
    db.close();
  });

  it("creates one service per repo, stamped archived because Bitbucket is frozen", () => {
    const db = legacy();
    db.exec(`INSERT INTO repos VALUES ('repo-a','Repo A','PROJ','develop',1)`);
    db.exec(`INSERT INTO sync_state VALUES ('repo-a','2026-09-28T13:00:00Z')`);
    run(db);
    const svc = db.prepare(
      `SELECT s.name, s.included, i.provider, i.repo_key, i.default_branch, i.group_key, i.state, i.last_synced_on
       FROM services s JOIN service_identities i ON i.service_id = s.id`).get();
    expect(svc).toEqual({
      name: "Repo A", included: 1, provider: "bitbucket", repo_key: "repo-a",
      default_branch: "develop", group_key: "PROJ", state: "archived",
      last_synced_on: "2026-09-28T13:00:00Z",
    });
    db.close();
  });

  it("does not duplicate a person who appears as both author and approver", () => {
    const db = legacy();
    db.exec(`INSERT INTO users VALUES ('u1','Alice',1)`);
    db.exec(`INSERT INTO pull_requests VALUES
      ('repo-a',1,'u1','PR','MERGED','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',1,NULL,'main','https://x/1')`);
    db.exec(`INSERT INTO approvals VALUES ('repo-a',1,'u1','2026-01-02T00:00:00Z')`);
    run(db);
    expect(db.prepare(`SELECT COUNT(*) c FROM people`).get()).toEqual({ c: 1 });
    db.close();
  });

  it("leaves every original table untouched", () => {
    const db = legacy();
    db.exec(`
      INSERT INTO users VALUES ('u1','Alice',1), ('u2','Bob',0);
      INSERT INTO repos VALUES ('repo-a','Repo A','PROJ','develop',1);
      INSERT INTO pull_requests VALUES
        ('repo-a',1,'u1','PR','MERGED','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',1,NULL,'main','https://x/1');
      INSERT INTO approvals VALUES ('repo-a',1,'u2','2026-01-02T00:00:00Z');
      INSERT INTO sync_state VALUES ('repo-a','2026-09-28T13:00:00Z');
    `);
    const dump = () => ({
      users: db.prepare(`SELECT * FROM users ORDER BY account_id`).all(),
      repos: db.prepare(`SELECT * FROM repos ORDER BY slug`).all(),
      pull_requests: db.prepare(`SELECT * FROM pull_requests ORDER BY repo_slug, id`).all(),
      approvals: db.prepare(`SELECT * FROM approvals ORDER BY repo_slug, pr_id, approver_account_id`).all(),
      sync_state: db.prepare(`SELECT * FROM sync_state ORDER BY repo_slug`).all(),
    });
    const before = dump();
    run(db);
    expect(dump()).toEqual(before);
    db.close();
  });

  it("gives a service to a repo_slug that has no repos row, named after the slug and excluded", () => {
    const db = legacy();
    db.exec(`INSERT INTO pull_requests VALUES
      ('gone-repo',1,'u1','PR','MERGED','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',1,NULL,'main','https://x/1')`);
    db.exec(`INSERT INTO approvals VALUES ('appr-only',1,'u1',NULL)`);
    db.exec(`INSERT INTO sync_state VALUES ('cursor-only','2026-09-28T13:00:00Z')`);
    run(db);
    const rows = db.prepare(
      `SELECT i.repo_key, s.name, s.included, i.default_branch, i.group_key, i.state
       FROM service_identities i JOIN services s ON s.id = i.service_id ORDER BY i.repo_key`).all();
    expect(rows).toEqual([
      { repo_key: "appr-only", name: "appr-only", included: 0, default_branch: "main", group_key: null, state: "archived" },
      { repo_key: "cursor-only", name: "cursor-only", included: 0, default_branch: "main", group_key: null, state: "archived" },
      { repo_key: "gone-repo", name: "gone-repo", included: 0, default_branch: "main", group_key: null, state: "archived" },
    ]);
    db.close();
  });

  it("keeps services distinct when two repos share a name", () => {
    const db = legacy();
    db.exec(`INSERT INTO repos VALUES ('a-api','API','P1','main',1), ('b-api','API','P2','main',0)`);
    run(db);
    const rows = db.prepare(
      `SELECT i.repo_key, i.service_id, s.included FROM service_identities i
       JOIN services s ON s.id = i.service_id ORDER BY i.repo_key`).all() as
      { repo_key: string; service_id: number; included: number }[];
    expect(rows).toHaveLength(2);
    expect(rows[0].service_id).not.toBe(rows[1].service_id);
    expect(rows.map((r) => r.included)).toEqual([1, 0]);
    db.close();
  });

  it("records a null last_synced_on for a repo that has never been synced", () => {
    const db = legacy();
    db.exec(`INSERT INTO repos VALUES ('repo-a','Repo A',NULL,'main',1)`);
    run(db);
    expect(db.prepare(`SELECT last_synced_on FROM service_identities`).get())
      .toEqual({ last_synced_on: null });
    db.close();
  });

  // Names are not unique. Linking identities by display name would cross the wires.
  it("keeps identities distinct when two people share a display name", () => {
    const db = legacy();
    db.exec(`INSERT INTO users VALUES ('u1','Alex Smith',1), ('u2','Alex Smith',1)`);
    run(db);
    const rows = db.prepare(
      `SELECT account_id, person_id FROM person_identities ORDER BY account_id`).all() as
      { account_id: string; person_id: number }[];
    expect(rows).toHaveLength(2);
    expect(rows[0].person_id).not.toBe(rows[1].person_id);
    db.close();
  });

  // Repo names are not unique either, and the account id of an undiscovered author
  // could coincide with a real person's display name.
  it("does not confuse an undiscovered account id with a real display name", () => {
    const db = legacy();
    db.exec(`INSERT INTO users VALUES ('u1','ghost',1)`);
    db.exec(`INSERT INTO pull_requests VALUES
      ('repo-a',1,'ghost','PR','MERGED','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',1,NULL,'main','https://x/1')`);
    run(db);
    const byAccount = db.prepare(
      `SELECT i.account_id, p.included FROM person_identities i
       JOIN people p ON p.id = i.person_id ORDER BY i.account_id`).all();
    // 'u1' is the included real user; 'ghost' is a separate, excluded person.
    expect(byAccount).toEqual([
      { account_id: "ghost", included: 0 },
      { account_id: "u1", included: 1 },
    ]);
    db.close();
  });

  it("runs on an empty database without error", () => {
    const db = legacy();
    run(db);
    expect(db.prepare(`SELECT COUNT(*) c FROM people`).get()).toEqual({ c: 0 });
    db.close();
  });

  // A brand-new file has no legacy tables at all. New and existing databases must
  // converge on the same shape through the same migrations, with no second code path.
  it("creates the legacy tables itself on a brand-new database", () => {
    const db = new Database(":memory:");
    runMigrations(db, [migration001]);
    expect(db.prepare(`SELECT COUNT(*) c FROM people`).get()).toEqual({ c: 0 });
    expect(db.prepare(`SELECT COUNT(*) c FROM pull_requests`).get()).toEqual({ c: 0 });
    db.close();
  });
});
