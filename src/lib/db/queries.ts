import type Database from "better-sqlite3";
import type {
  PullRequestRecord, ApprovalRecord, UserRecord, RepoRecord, PullRequestState,
  ProviderId, Precision,
} from "@/types";
import { upsertPersonIdentity, upsertServiceIdentity } from "@/lib/db/canonical";

export const upsertUsers = (
  db: Database.Database,
  users: { accountId: string; displayName: string }[],
): void => {
  const stmt = db.prepare(
    // New users arrive excluded; re-running Discover never changes an existing choice.
    `INSERT INTO users (account_id, display_name, included) VALUES (@accountId, @displayName, 0)
     ON CONFLICT(account_id) DO UPDATE SET display_name = excluded.display_name`,
  );
  // The roster still speaks Bitbucket account ids; mirroring into the canonical tables
  // keeps what the user ticks and what the analytics read the same thing.
  const tx = db.transaction((rows: typeof users) => rows.forEach((r) => {
    stmt.run(r);
    upsertPersonIdentity(db, "bitbucket", r.accountId, r.displayName);
  }));
  tx(users);
};

export const upsertRepos = (
  db: Database.Database,
  repos: { slug: string; name: string; projectKey: string | null; mainBranch: string }[],
): void => {
  const stmt = db.prepare(
    // New repos arrive excluded — see users above.
    `INSERT INTO repos (slug, name, project_key, main_branch, included)
     VALUES (@slug, @name, @projectKey, @mainBranch, 0)
     ON CONFLICT(slug) DO UPDATE SET
       name = excluded.name,
       project_key = excluded.project_key,
       main_branch = excluded.main_branch`,
  );
  const tx = db.transaction((rows: typeof repos) => rows.forEach((r) => {
    stmt.run(r);
    upsertServiceIdentity(db, "bitbucket", r.slug, r.name, r.mainBranch, r.projectKey);
  }));
  tx(repos);
};

export const setUserIncluded = (db: Database.Database, accountId: string, included: boolean): void => {
  db.prepare(`UPDATE users SET included = ? WHERE account_id = ?`).run(included ? 1 : 0, accountId);
  db.prepare(
    `UPDATE people SET included = ?
     WHERE id IN (SELECT person_id FROM person_identities WHERE provider = 'bitbucket' AND account_id = ?)`,
  ).run(included ? 1 : 0, accountId);
};

export const setRepoIncluded = (db: Database.Database, slug: string, included: boolean): void => {
  db.prepare(`UPDATE repos SET included = ? WHERE slug = ?`).run(included ? 1 : 0, slug);
  db.prepare(
    `UPDATE services SET included = ?
     WHERE id IN (SELECT service_id FROM service_identities WHERE provider = 'bitbucket' AND repo_key = ?)`,
  ).run(included ? 1 : 0, slug);
};

export const upsertPullRequest = (db: Database.Database, pr: PullRequestRecord): void => {
  db.prepare(
    `INSERT INTO pull_requests
       (provider, repo_key, number, service_id, person_id, title, state, created_on,
        ready_for_review_on, ready_for_review_precision, merged_on, merged_on_precision,
        destination_branch, url)
     VALUES
       (@provider, @repoKey, @number, @serviceId, @personId, @title, @state, @createdOn,
        @readyForReviewOn, @readyForReviewPrecision, @mergedOn, @mergedOnPrecision,
        @destinationBranch, @url)
     ON CONFLICT(provider, repo_key, number) DO UPDATE SET
       service_id = excluded.service_id,
       person_id = excluded.person_id,
       title = excluded.title,
       state = excluded.state,
       created_on = excluded.created_on,
       -- A derived or exact ready time is better data than a createdOn guess, so
       -- never let a later fast sync (fallback) overwrite one.
       ready_for_review_on = CASE
         WHEN excluded.ready_for_review_precision != 'fallback' THEN excluded.ready_for_review_on
         WHEN pull_requests.ready_for_review_precision != 'fallback' THEN pull_requests.ready_for_review_on
         ELSE excluded.ready_for_review_on END,
       ready_for_review_precision = CASE
         WHEN excluded.ready_for_review_precision != 'fallback' THEN excluded.ready_for_review_precision
         ELSE pull_requests.ready_for_review_precision END,
       merged_on = excluded.merged_on,
       merged_on_precision = excluded.merged_on_precision,
       destination_branch = excluded.destination_branch,
       url = excluded.url`,
  ).run(pr);
};

// Additive counterpart to replaceApprovals, for the fast (list-only) sync path:
// adds approvers we did not know about without discarding timestamps already
// recorded by a deep sync. Cannot observe withdrawn approvals — a deep sync
// reconciles those.
export const mergeApprovals = (
  db: Database.Database, approvals: ApprovalRecord[],
): void => {
  const ins = db.prepare(
    `INSERT INTO approvals (provider, repo_key, pr_number, approver_account_id, person_id, approved_on)
     VALUES (@provider, @repoKey, @prNumber, @approverAccountId, @personId, @approvedOn)
     ON CONFLICT(provider, repo_key, pr_number, approver_account_id) DO NOTHING`,
  );
  const tx = db.transaction((rows: ApprovalRecord[]) => rows.forEach((a) => ins.run(a)));
  tx(approvals);
};

export const replaceApprovals = (
  db: Database.Database, provider: ProviderId, repoKey: string, prNumber: number,
  approvals: ApprovalRecord[],
): void => {
  const del = db.prepare(`DELETE FROM approvals WHERE provider = ? AND repo_key = ? AND pr_number = ?`);
  const ins = db.prepare(
    `INSERT OR REPLACE INTO approvals (provider, repo_key, pr_number, approver_account_id, person_id, approved_on)
     VALUES (@provider, @repoKey, @prNumber, @approverAccountId, @personId, @approvedOn)`,
  );
  const tx = db.transaction(() => {
    del.run(provider, repoKey, prNumber);
    approvals.forEach((a) => ins.run(a));
  });
  tx();
};

type UserRow = { account_id: string; display_name: string; included: number };
export const getUsers = (db: Database.Database): UserRecord[] =>
  // COLLATE NOCASE: SQLite's default collation sorts all uppercase before lowercase,
  // which scatters names like "carolyn.symonds" below every capitalised name.
  (db.prepare(`SELECT account_id, display_name, included FROM users ORDER BY display_name COLLATE NOCASE`).all() as UserRow[])
    .map((r) => ({ accountId: r.account_id, displayName: r.display_name, included: !!r.included }));

type RepoRow = { slug: string; name: string; project_key: string | null; main_branch: string; included: number };
export const getRepos = (db: Database.Database): RepoRecord[] =>
  (db.prepare(`SELECT slug, name, project_key, main_branch, included FROM repos ORDER BY name COLLATE NOCASE`).all() as RepoRow[])
    .map((r) => ({ slug: r.slug, name: r.name, projectKey: r.project_key, mainBranch: r.main_branch, included: !!r.included }));

type PrRow = {
  provider: string; repo_key: string; number: number; service_id: number; person_id: number;
  title: string; state: string; created_on: string; ready_for_review_on: string;
  ready_for_review_precision: string; merged_on: string | null; merged_on_precision: string | null;
  destination_branch: string; url: string;
};
export const getPullRequests = (db: Database.Database): PullRequestRecord[] =>
  (db.prepare(`SELECT provider, repo_key, number, service_id, person_id, title, state, created_on, ready_for_review_on, ready_for_review_precision, merged_on, merged_on_precision, destination_branch, url FROM pull_requests`).all() as PrRow[]).map((r) => ({
    provider: r.provider as ProviderId, repoKey: r.repo_key, number: r.number,
    serviceId: r.service_id, personId: r.person_id, title: r.title,
    // Rows migrated from before CLOSED existed still say DECLINED/SUPERSEDED; both
    // always meant abandoned, so they read back as CLOSED rather than as unknown states.
    state: (r.state === "OPEN" || r.state === "MERGED" ? r.state : "CLOSED") as PullRequestState,
    createdOn: r.created_on, readyForReviewOn: r.ready_for_review_on,
    readyForReviewPrecision: r.ready_for_review_precision as Precision, mergedOn: r.merged_on,
    mergedOnPrecision: r.merged_on_precision as Precision | null,
    destinationBranch: r.destination_branch, url: r.url,
  }));

type ApprovalRow = {
  provider: string; repo_key: string; pr_number: number; approver_account_id: string;
  person_id: number; approved_on: string | null;
};
export const getApprovals = (db: Database.Database): ApprovalRecord[] =>
  (db.prepare(`SELECT provider, repo_key, pr_number, approver_account_id, person_id, approved_on FROM approvals`).all() as ApprovalRow[]).map((r) => ({
    provider: r.provider as ProviderId, repoKey: r.repo_key, prNumber: r.pr_number,
    approverAccountId: r.approver_account_id, personId: r.person_id, approvedOn: r.approved_on,
  }));

// The incremental cursor lives on the service identity, so each provider's copy of a
// service keeps its own.
export const getLastSynced = (db: Database.Database, provider: ProviderId, repoKey: string): string | null => {
  const row = db.prepare(
    `SELECT last_synced_on FROM service_identities WHERE provider = ? AND repo_key = ?`,
  ).get(provider, repoKey) as { last_synced_on: string | null } | undefined;
  return row?.last_synced_on ?? null;
};

// A no-op for an unknown identity: sync registers the identity before it stamps it.
export const setLastSynced = (db: Database.Database, provider: ProviderId, repoKey: string, iso: string): void => {
  db.prepare(
    `UPDATE service_identities SET last_synced_on = ? WHERE provider = ? AND repo_key = ?`,
  ).run(iso, provider, repoKey);
};
