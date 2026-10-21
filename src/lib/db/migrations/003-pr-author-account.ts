// src/lib/db/migrations/003-pr-author-account.ts
import type { Migration } from "./runner";

// pull_requests recorded only the canonical person, never which provider account
// authored the PR. That made a merge of two same-provider people irreversible: an
// un-merge could not tell the two identities' PRs apart, so splitting was refused
// outright and a mistaken merge had no way back.
//
// The column can be backfilled EXACTLY rather than guessed, because migration 002
// renamed the pre-migration table instead of dropping it: legacy_pull_requests still
// holds author_account_id for every Bitbucket row. That is only true while the legacy
// table survives, which is why this runs now rather than later.
//
// Rollback: additive and nullable. `ALTER TABLE pull_requests DROP COLUMN
// author_account_id` reverses it; code that ignores the column behaves as before.
// Row counts are untouched, so the runner's guard covers the backfill.
const migration: Migration = {
  version: 3,
  name: "pr-author-account",
  up: (db) => {
    // Nullable, and honestly so: rows synced before this migration have no account id
    // recorded anywhere recoverable except Bitbucket's legacy table. A GitHub row stays
    // null until its next sync fills it in.
    db.exec(`ALTER TABLE pull_requests ADD COLUMN author_account_id TEXT;`);

    db.exec(`
      UPDATE pull_requests
      SET author_account_id = (
        SELECT l.author_account_id
        FROM legacy_pull_requests l
        WHERE l.repo_slug = pull_requests.repo_key AND l.id = pull_requests.number
      )
      WHERE provider = 'bitbucket';
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_pr_author ON pull_requests(provider, author_account_id);`);
  },
};

export default migration;
