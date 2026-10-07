// src/lib/db/migrations/001-canonical-entities.ts
import type { Migration } from "./runner";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id           INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  included     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS person_identities (
  provider   TEXT NOT NULL,
  account_id TEXT NOT NULL,
  person_id  INTEGER NOT NULL REFERENCES people(id),
  PRIMARY KEY (provider, account_id)
);

CREATE TABLE IF NOT EXISTS services (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  included INTEGER NOT NULL DEFAULT 0
);

-- state: 'active'   — fetched on every sync
--        'archived' — read-only history; never fetched (every Bitbucket identity)
--        'missing'  — a 404 on the repo's own PR list; surfaced as a warning
CREATE TABLE IF NOT EXISTS service_identities (
  provider       TEXT NOT NULL,
  repo_key       TEXT NOT NULL,
  service_id     INTEGER NOT NULL REFERENCES services(id),
  default_branch TEXT NOT NULL DEFAULT 'main',
  group_key      TEXT,
  state          TEXT NOT NULL DEFAULT 'active',
  last_synced_on TEXT,
  PRIMARY KEY (provider, repo_key)
);

CREATE INDEX IF NOT EXISTS idx_person_identities_person ON person_identities(person_id);
CREATE INDEX IF NOT EXISTS idx_service_identities_service ON service_identities(service_id);
`;

const migration: Migration = {
  version: 1,
  name: "canonical-entities",
  up: (db) => {
    // A fresh database has no legacy tables to read from. Creating them empty keeps one
    // code path for new and decade-old files alike: both converge on the same shape by
    // the same migrations. Migration 002 renames them to legacy_* immediately after.
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (account_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, included INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS repos (slug TEXT PRIMARY KEY, name TEXT NOT NULL, project_key TEXT, main_branch TEXT NOT NULL DEFAULT 'main', included INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS pull_requests (
        repo_slug TEXT NOT NULL, id INTEGER NOT NULL, author_account_id TEXT NOT NULL,
        title TEXT NOT NULL, state TEXT NOT NULL, created_on TEXT NOT NULL,
        ready_for_review_on TEXT NOT NULL, ready_is_fallback INTEGER NOT NULL DEFAULT 1,
        merged_on TEXT, destination_branch TEXT NOT NULL, url TEXT NOT NULL,
        PRIMARY KEY (repo_slug, id));
      CREATE TABLE IF NOT EXISTS approvals (
        repo_slug TEXT NOT NULL, pr_id INTEGER NOT NULL, approver_account_id TEXT NOT NULL,
        approved_on TEXT, PRIMARY KEY (repo_slug, pr_id, approver_account_id));
      CREATE TABLE IF NOT EXISTS sync_state (repo_slug TEXT PRIMARY KEY, last_synced_on TEXT NOT NULL);
    `);

    db.exec(SCHEMA);

    // People come from the UNION of everyone who appears anywhere, not from `users`
    // alone. Discovery only ever found the current workspace membership, while the PR
    // history reaches back years: in the real cache 53 of 74 distinct authors are
    // absent from `users`, and building from `users` alone would orphan 56.6% of PRs
    // when migration 002 rebuilds them.
    //
    // Done row by row rather than in one INSERT...SELECT because the only key that
    // links a new person to its identity is the rowid the insert just produced.
    // Joining `people` back on display_name would be wrong: names are not unique, and
    // an undiscovered account id could collide with a real person's display name.
    type AccountRow = { account_id: string };
    type UserRow = { account_id: string; display_name: string; included: number };

    const accountIds = db.prepare(`
      SELECT account_id FROM users
      UNION SELECT author_account_id FROM pull_requests
      UNION SELECT approver_account_id FROM approvals
      ORDER BY account_id
    `).all() as AccountRow[];

    const users = new Map(
      (db.prepare(`SELECT account_id, display_name, included FROM users`).all() as UserRow[])
        .map((u) => [u.account_id, u]),
    );

    const insertPerson = db.prepare(`INSERT INTO people (display_name, included) VALUES (?, ?)`);
    const insertPersonIdentity = db.prepare(
      `INSERT INTO person_identities (provider, account_id, person_id) VALUES ('bitbucket', ?, ?)`,
    );

    for (const { account_id } of accountIds) {
      const user = users.get(account_id);
      // No display name exists for someone never discovered, so the account id stands
      // in. included stays 0 — joining the roster must remain a deliberate act.
      const { lastInsertRowid } = insertPerson.run(
        user?.display_name ?? account_id,
        user?.included ?? 0,
      );
      insertPersonIdentity.run(account_id, lastInsertRowid);
    }

    // Services mirror repos one-for-one, keyed on slug for the same reason: repo names
    // are not guaranteed unique either.
    //
    // Every Bitbucket identity is stamped 'archived' here as an asserted fact rather
    // than inferred later from a 404 — inferring repo state from an error code is
    // exactly what mistook two migrated repos for deleted ones in August.
    type RepoRow = {
      slug: string; name: string; project_key: string | null;
      main_branch: string; included: number;
    };

    const repos = db.prepare(
      `SELECT slug, name, project_key, main_branch, included FROM repos ORDER BY slug`,
    ).all() as RepoRow[];

    const cursors = new Map(
      (db.prepare(`SELECT repo_slug, last_synced_on FROM sync_state`).all() as
        { repo_slug: string; last_synced_on: string }[])
        .map((r) => [r.repo_slug, r.last_synced_on]),
    );

    const insertService = db.prepare(`INSERT INTO services (name, included) VALUES (?, ?)`);
    const insertServiceIdentity = db.prepare(`
      INSERT INTO service_identities
        (provider, repo_key, service_id, default_branch, group_key, state, last_synced_on)
      VALUES ('bitbucket', ?, ?, ?, ?, 'archived', ?)
    `);

    for (const repo of repos) {
      const { lastInsertRowid } = insertService.run(repo.name, repo.included);
      insertServiceIdentity.run(
        repo.slug, lastInsertRowid, repo.main_branch, repo.project_key,
        cursors.get(repo.slug) ?? null,
      );
    }
  },
};

export default migration;
