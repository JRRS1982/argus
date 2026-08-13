import type Database from "better-sqlite3";
import type {
  PullRequestRecord, ApprovalRecord, UserRecord, RepoRecord, PullRequestState,
} from "@/types";

export const upsertUsers = (
  db: Database.Database,
  users: { accountId: string; displayName: string }[],
): void => {
  const stmt = db.prepare(
    // New users arrive excluded; re-running Discover never changes an existing choice.
    `INSERT INTO users (account_id, display_name, included) VALUES (@accountId, @displayName, 0)
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
    // New repos arrive excluded — see users above.
    `INSERT INTO repos (slug, name, project_key, main_branch, included)
     VALUES (@slug, @name, @projectKey, @mainBranch, 0)
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
       -- A derived ready time (fallback = 0) is better data than a createdOn
       -- guess, so never let a later fast sync overwrite one.
       ready_for_review_on = CASE
         WHEN excluded.ready_is_fallback = 0 THEN excluded.ready_for_review_on
         WHEN pull_requests.ready_is_fallback = 0 THEN pull_requests.ready_for_review_on
         ELSE excluded.ready_for_review_on END,
       ready_is_fallback = CASE
         WHEN excluded.ready_is_fallback = 0 THEN 0
         ELSE pull_requests.ready_is_fallback END,
       merged_on = excluded.merged_on,
       destination_branch = excluded.destination_branch,
       url = excluded.url`,
  ).run({ ...pr, readyIsFallback: pr.readyIsFallback ? 1 : 0 });
};

// Additive counterpart to replaceApprovals, for the fast (list-only) sync path:
// adds approvers we did not know about without discarding timestamps already
// recorded by a deep sync. Cannot observe withdrawn approvals — a deep sync
// reconciles those.
export const mergeApprovals = (
  db: Database.Database, approvals: ApprovalRecord[],
): void => {
  const ins = db.prepare(
    `INSERT INTO approvals (repo_slug, pr_id, approver_account_id, approved_on)
     VALUES (@repoSlug, @prId, @approverAccountId, @approvedOn)
     ON CONFLICT(repo_slug, pr_id, approver_account_id) DO NOTHING`,
  );
  const tx = db.transaction((rows: ApprovalRecord[]) => rows.forEach((a) => ins.run(a)));
  tx(approvals);
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
  // COLLATE NOCASE: SQLite's default collation sorts all uppercase before lowercase,
  // which scatters names like "carolyn.symonds" below every capitalised name.
  (db.prepare(`SELECT account_id, display_name, included FROM users ORDER BY display_name COLLATE NOCASE`).all() as UserRow[])
    .map((r) => ({ accountId: r.account_id, displayName: r.display_name, included: !!r.included }));

type RepoRow = { slug: string; name: string; project_key: string | null; main_branch: string; included: number };
export const getRepos = (db: Database.Database): RepoRecord[] =>
  (db.prepare(`SELECT slug, name, project_key, main_branch, included FROM repos ORDER BY name COLLATE NOCASE`).all() as RepoRow[])
    .map((r) => ({ slug: r.slug, name: r.name, projectKey: r.project_key, mainBranch: r.main_branch, included: !!r.included }));

type PrRow = {
  repo_slug: string; id: number; author_account_id: string; title: string; state: string;
  created_on: string; ready_for_review_on: string; ready_is_fallback: number;
  merged_on: string | null; destination_branch: string; url: string;
};
export const getPullRequests = (db: Database.Database): PullRequestRecord[] =>
  (db.prepare(`SELECT repo_slug, id, author_account_id, title, state, created_on, ready_for_review_on, ready_is_fallback, merged_on, destination_branch, url FROM pull_requests`).all() as PrRow[]).map((r) => ({
    id: r.id, repoSlug: r.repo_slug, authorAccountId: r.author_account_id, title: r.title,
    state: r.state as PullRequestState, createdOn: r.created_on, readyForReviewOn: r.ready_for_review_on,
    readyIsFallback: !!r.ready_is_fallback, mergedOn: r.merged_on,
    destinationBranch: r.destination_branch, url: r.url,
  }));

type ApprovalRow = { repo_slug: string; pr_id: number; approver_account_id: string; approved_on: string | null };
export const getApprovals = (db: Database.Database): ApprovalRecord[] =>
  (db.prepare(`SELECT repo_slug, pr_id, approver_account_id, approved_on FROM approvals`).all() as ApprovalRow[]).map((r) => ({
    repoSlug: r.repo_slug, prId: r.pr_id, approverAccountId: r.approver_account_id, approvedOn: r.approved_on,
  }));

export const getLastSynced = (db: Database.Database, repoSlug: string): string | null => {
  const row = db.prepare(`SELECT last_synced_on FROM sync_state WHERE repo_slug = ?`).get(repoSlug) as
    | { last_synced_on: string } | undefined;
  return row ? row.last_synced_on : null;
};

// When the data was last refreshed: the newest sync stamp among included repos.
// syncAll stamps every repo in a run with the same instant, so after a successful
// Refresh this is simply when that refresh ran. Null until a first sync happens.
export const getLastRefreshed = (db: Database.Database): string | null => {
  const row = db.prepare(
    `SELECT MAX(last_synced_on) AS last
     FROM sync_state s JOIN repos r ON r.slug = s.repo_slug
     WHERE r.included = 1`,
  ).get() as { last: string | null };
  return row.last;
};

export const setLastSynced = (db: Database.Database, repoSlug: string, iso: string): void => {
  db.prepare(
    `INSERT INTO sync_state (repo_slug, last_synced_on) VALUES (?, ?)
     ON CONFLICT(repo_slug) DO UPDATE SET last_synced_on = excluded.last_synced_on`,
  ).run(repoSlug, iso);
};
