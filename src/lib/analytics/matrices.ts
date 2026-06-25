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
