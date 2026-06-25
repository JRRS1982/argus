import { describe, it, expect } from "vitest";
import { computePrsCreatedMatrix, computeApprovalMatrix } from "@/lib/analytics/matrices";
import type { PullRequestRecord, ApprovalRecord, RepoRecord, UserRecord } from "@/types";

const users: UserRecord[] = [
  { accountId: "u1", displayName: "Alice", included: true },
  { accountId: "u2", displayName: "Bob", included: true },
  { accountId: "u3", displayName: "Excluded", included: false },
];
const repos: RepoRecord[] = [
  { slug: "repo-a", name: "Repo A", projectKey: null, mainBranch: "main", included: true },
  { slug: "repo-b", name: "Repo B", projectKey: null, mainBranch: "main", included: true },
  { slug: "repo-x", name: "Repo X", projectKey: null, mainBranch: "main", included: false },
];
const SINCE = "2026-01-01T00:00:00.000Z";

const pr = (over: Partial<PullRequestRecord>): PullRequestRecord => ({
  id: 1, repoSlug: "repo-a", authorAccountId: "u1", title: "T", state: "MERGED",
  createdOn: "2026-02-01T00:00:00.000Z", readyForReviewOn: "2026-02-01T00:00:00.000Z",
  readyIsFallback: false, mergedOn: "2026-02-02T00:00:00.000Z",
  destinationBranch: "main", url: "https://x/1", ...over,
});

describe("computePrsCreatedMatrix", () => {
  it("counts PRs created per included user per included repo, with totals", () => {
    const prs = [
      pr({ id: 1, authorAccountId: "u1", repoSlug: "repo-a" }),
      pr({ id: 2, authorAccountId: "u1", repoSlug: "repo-b" }),
      pr({ id: 3, authorAccountId: "u2", repoSlug: "repo-a" }),
      pr({ id: 4, authorAccountId: "u1", repoSlug: "repo-x" }),                    // excluded repo
      pr({ id: 5, authorAccountId: "u3", repoSlug: "repo-a" }),                    // excluded user
      pr({ id: 6, authorAccountId: "u1", repoSlug: "repo-a", createdOn: "2025-06-01T00:00:00.000Z" }), // out of window
    ];
    const m = computePrsCreatedMatrix(prs, repos, users, SINCE);
    expect(m.rowUsers.map((u) => u.displayName)).toEqual(["Alice", "Bob"]);
    expect(m.colHeaders.map((c) => c.label)).toEqual(["Repo A", "Repo B"]);
    expect(m.cells).toEqual([[1, 1], [1, 0]]);
    expect(m.rowTotals).toEqual([2, 1]);
    expect(m.colTotals).toEqual([2, 1]);
  });
});

describe("computeApprovalMatrix", () => {
  it("counts how often each author's PRs were approved by each approver, excluding self-approval", () => {
    const prs = [
      pr({ id: 1, authorAccountId: "u1" }),
      pr({ id: 2, authorAccountId: "u2" }),
    ];
    const approvals: ApprovalRecord[] = [
      { repoSlug: "repo-a", prId: 1, approverAccountId: "u2", approvedOn: null }, // Bob approved Alice's PR1
      { repoSlug: "repo-a", prId: 1, approverAccountId: "u1", approvedOn: null }, // self-approval -> ignored
      { repoSlug: "repo-a", prId: 2, approverAccountId: "u1", approvedOn: null }, // Alice approved Bob's PR2
    ];
    const m = computeApprovalMatrix(prs, approvals, users, SINCE);
    // rows = authors, cols = approvers (both included users)
    expect(m.rowUsers.map((u) => u.displayName)).toEqual(["Alice", "Bob"]);
    expect(m.colHeaders.map((c) => c.label)).toEqual(["Alice", "Bob"]);
    // Alice(row) approved-by Bob(col) = 1; Bob(row) approved-by Alice(col) = 1; diagonal 0
    expect(m.cells).toEqual([[0, 1], [1, 0]]);
    expect(m.rowTotals).toEqual([1, 1]);
    expect(m.colTotals).toEqual([1, 1]);
  });
});
