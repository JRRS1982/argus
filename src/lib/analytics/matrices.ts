import type { Matrix, PullRequestRecord, ApprovalRecord, RepoRecord, UserRecord } from "@/types";
import { buildPrScope, isInScope } from "./scope";
import { byDisplayName } from "./sort";

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
  const rowUsers = users
    .filter((u) => u.included)
    .map((u) => ({ accountId: u.accountId, displayName: u.displayName }))
    .sort(byDisplayName);
  const cols = repos.filter((r) => r.included);
  const colHeaders = cols.map((r) => ({ key: r.slug, label: r.name }));
  const rowIndex = new Map(rowUsers.map((u, i) => [u.accountId, i]));
  const colIndex = new Map(cols.map((r, i) => [r.slug, i]));
  const cells = zeros(rowUsers.length, cols.length);
  const scope = buildPrScope(repos);

  for (const pr of prs) {
    if (pr.createdOn < sinceIso || !isInScope(pr, scope)) continue;
    const r = rowIndex.get(pr.authorAccountId);
    const c = colIndex.get(pr.repoSlug);
    if (r === undefined || c === undefined) continue;
    cells[r][c] += 1;
  }
  // Breadth: how many distinct services (repos) each engineer opened at least one PR in.
  const distinctServices = cells.map((row) => row.filter((n) => n > 0).length);
  return {
    ...withTotals(rowUsers, colHeaders, cells),
    extraColumn: { label: "Services", values: distinctServices },
  };
};

export const computeApprovalMatrix = (
  prs: PullRequestRecord[],
  approvals: ApprovalRecord[],
  repos: RepoRecord[],
  users: UserRecord[],
  sinceIso: string,
): Matrix => {
  const included = users
    .filter((u) => u.included)
    .map((u) => ({ accountId: u.accountId, displayName: u.displayName }))
    .sort(byDisplayName);
  const rowUsers = included;
  const colHeaders = included.map((u) => ({ key: u.accountId, label: u.displayName }));
  const rowIndex = new Map(included.map((u, i) => [u.accountId, i]));
  const colIndex = new Map(included.map((u, i) => [u.accountId, i]));
  const cells = zeros(included.length, included.length);

  // author lookup per PR, restricted to in-window, non-abandoned PRs
  const authorByKey = new Map<string, string>();
  const mergedKeys = new Set<string>();
  const scope = buildPrScope(repos);
  for (const pr of prs) {
    if (pr.createdOn < sinceIso || !isInScope(pr, scope)) continue;
    const key = `${pr.repoSlug}#${pr.id}`;
    authorByKey.set(key, pr.authorAccountId);
    if (pr.state === "MERGED") mergedKeys.add(key);
  }

  // Merged PRs that nobody else approved. They belong in the picture, but there is
  // no approver to attribute them to, so they get a column of their own rather
  // than being silently absent from the grid.
  const approvedKeys = new Set<string>();

  for (const a of approvals) {
    const key = `${a.repoSlug}#${a.prId}`;
    const author = authorByKey.get(key);
    if (author === undefined) continue;
    if (author === a.approverAccountId) continue; // exclude self-approval
    approvedKeys.add(key);
    const r = rowIndex.get(author);
    const c = colIndex.get(a.approverAccountId);
    if (r === undefined || c === undefined) continue;
    cells[r][c] += 1;
  }

  const unapproved = Array.from({ length: included.length }, () => 0);
  for (const key of mergedKeys) {
    if (approvedKeys.has(key)) continue;
    const r = rowIndex.get(authorByKey.get(key)!);
    if (r === undefined) continue;
    unapproved[r] += 1;
  }

  return {
    ...withTotals(rowUsers, colHeaders, cells),
    extraColumn: { label: "Merged, no approval", values: unapproved },
  };
};
