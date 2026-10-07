// src/lib/db/migrations/002-provider-keyed-prs.ts
import type { Migration } from "./runner";

// The runner's row-count guard reads `pull_requests` before and after. This migration
// renames the original out of the way and creates a replacement of the same name, so
// the guard compares like with like and still fires if a row is lost in the copy.
const migration: Migration = {
  version: 2,
  name: "provider-keyed-prs",
  up: (db) => {
    db.exec(`
      ALTER TABLE pull_requests RENAME TO legacy_pull_requests;
      ALTER TABLE approvals     RENAME TO legacy_approvals;

      CREATE TABLE pull_requests (
        provider                   TEXT    NOT NULL,
        repo_key                   TEXT    NOT NULL,
        number                     INTEGER NOT NULL,
        service_id                 INTEGER NOT NULL REFERENCES services(id),
        person_id                  INTEGER NOT NULL REFERENCES people(id),
        title                      TEXT    NOT NULL,
        state                      TEXT    NOT NULL,
        created_on                 TEXT    NOT NULL,
        ready_for_review_on        TEXT    NOT NULL,
        ready_for_review_precision TEXT    NOT NULL,
        merged_on                  TEXT,
        merged_on_precision        TEXT,
        destination_branch         TEXT    NOT NULL,
        url                        TEXT    NOT NULL,
        PRIMARY KEY (provider, repo_key, number)
      );

      CREATE TABLE approvals (
        provider            TEXT    NOT NULL,
        repo_key            TEXT    NOT NULL,
        pr_number           INTEGER NOT NULL,
        approver_account_id TEXT    NOT NULL,
        person_id           INTEGER NOT NULL REFERENCES people(id),
        approved_on         TEXT,
        PRIMARY KEY (provider, repo_key, pr_number, approver_account_id)
      );

      CREATE INDEX idx_pr_service ON pull_requests(service_id);
      CREATE INDEX idx_pr_person  ON pull_requests(person_id);
      CREATE INDEX idx_appr_person ON approvals(person_id);
    `);

    // Inner joins are safe only because migration 001 guaranteed an identity for every
    // author, approver and repo that appears here. If that guarantee ever breaks, the
    // runner's row-count assertion fires and the whole run rolls back.
    //
    // Bitbucket's merge timestamp is the `updated_on` proxy, never an exact merge time,
    // so every migrated row is 'derived'. ready_is_fallback 1 -> 'fallback' (creation
    // time stood in), 0 -> 'derived' (a real draft->ready transition was observed).
    db.exec(`
      INSERT INTO pull_requests
        (provider, repo_key, number, service_id, person_id, title, state, created_on,
         ready_for_review_on, ready_for_review_precision, merged_on, merged_on_precision,
         destination_branch, url)
      SELECT 'bitbucket', l.repo_slug, l.id, si.service_id, pi.person_id, l.title, l.state,
             l.created_on, l.ready_for_review_on,
             CASE WHEN l.ready_is_fallback = 1 THEN 'fallback' ELSE 'derived' END,
             l.merged_on,
             CASE WHEN l.merged_on IS NULL THEN NULL ELSE 'derived' END,
             l.destination_branch, l.url
      FROM legacy_pull_requests l
      JOIN service_identities si ON si.provider = 'bitbucket' AND si.repo_key = l.repo_slug
      JOIN person_identities  pi ON pi.provider = 'bitbucket' AND pi.account_id = l.author_account_id;

      INSERT INTO approvals
        (provider, repo_key, pr_number, approver_account_id, person_id, approved_on)
      SELECT 'bitbucket', l.repo_slug, l.pr_id, l.approver_account_id, pi.person_id, l.approved_on
      FROM legacy_approvals l
      JOIN person_identities pi ON pi.provider = 'bitbucket' AND pi.account_id = l.approver_account_id;
    `);
  },
};

export default migration;
