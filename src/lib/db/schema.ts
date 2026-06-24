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
