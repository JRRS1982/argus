import type { Matrix, PullRequestRecord, ApprovalRecord, Person, Service } from "@/types";
import { buildPrScope, isInScope } from "./scope";
import { byDisplayName } from "./sort";

// A PR number is unique only within a repo, and a repo key only within a provider.
const prKey = (provider: string, repoKey: string, number: number): string =>
  `${provider}:${repoKey}#${number}`;

const zeros = (rows: number, cols: number): number[][] =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));

const withTotals = (
  rowUsers: { personId: number; displayName: string }[],
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
  services: Service[],
  people: Person[],
  sinceIso: string,
): Matrix => {
  const rowUsers = people
    .filter((p) => p.included)
    .map((p) => ({ personId: p.id, displayName: p.displayName }))
    .sort(byDisplayName);
  const cols = services.filter((s) => s.included);
  const colHeaders = cols.map((s) => ({ key: String(s.id), label: s.name }));
  const rowIndex = new Map(rowUsers.map((u, i) => [u.personId, i]));
  const colIndex = new Map(cols.map((s, i) => [s.id, i]));
  const cells = zeros(rowUsers.length, cols.length);
  const scope = buildPrScope(services);

  for (const pr of prs) {
    if (pr.createdOn < sinceIso || !isInScope(pr, scope)) continue;
    const r = rowIndex.get(pr.personId);
    const c = colIndex.get(pr.serviceId);
    if (r === undefined || c === undefined) continue;
    cells[r][c] += 1;
  }
  // A repo nobody opened a PR in adds nothing but width — drop its column.
  const hasPrs = cols.map((_, c) => cells.some((row) => row[c] > 0));
  const shownHeaders = colHeaders.filter((_, c) => hasPrs[c]);
  const shownCells = cells.map((row) => row.filter((_, c) => hasPrs[c]));

  // Breadth: how many distinct services (repos) each engineer opened at least one PR in.
  const distinctServices = shownCells.map((row) => row.filter((n) => n > 0).length);
  return {
    ...withTotals(rowUsers, shownHeaders, shownCells),
    extraColumn: { label: "Services", values: distinctServices },
  };
};

export const computeApprovalMatrix = (
  prs: PullRequestRecord[],
  approvals: ApprovalRecord[],
  services: Service[],
  people: Person[],
  sinceIso: string,
): Matrix => {
  const included = people
    .filter((p) => p.included)
    .map((p) => ({ personId: p.id, displayName: p.displayName }))
    .sort(byDisplayName);
  const rowUsers = included;
  const colHeaders = included.map((u) => ({ key: String(u.personId), label: u.displayName }));
  const rowIndex = new Map(included.map((u, i) => [u.personId, i]));
  const colIndex = new Map(included.map((u, i) => [u.personId, i]));
  const cells = zeros(included.length, included.length);

  // author lookup per PR, restricted to in-window, non-abandoned PRs
  const authorByKey = new Map<string, number>();
  const mergedKeys = new Set<string>();
  const scope = buildPrScope(services);
  for (const pr of prs) {
    if (pr.createdOn < sinceIso || !isInScope(pr, scope)) continue;
    const key = prKey(pr.provider, pr.repoKey, pr.number);
    authorByKey.set(key, pr.personId);
    if (pr.state === "MERGED") mergedKeys.add(key);
  }

  // Merged PRs that nobody else approved. They belong in the picture, but there is
  // no approver to attribute them to, so they get a column of their own rather
  // than being silently absent from the grid.
  const approvedKeys = new Set<string>();

  for (const a of approvals) {
    const key = prKey(a.provider, a.repoKey, a.prNumber);
    const author = authorByKey.get(key);
    if (author === undefined) continue;
    if (author === a.personId) continue; // exclude self-approval
    approvedKeys.add(key);
    const r = rowIndex.get(author);
    const c = colIndex.get(a.personId);
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
