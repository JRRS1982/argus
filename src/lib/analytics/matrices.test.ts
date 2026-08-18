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

  it("omits repos with no in-scope PRs from the columns", () => {
    const prs = [
      pr({ id: 1, authorAccountId: "u1", repoSlug: "repo-a" }),
      pr({ id: 2, repoSlug: "repo-b", state: "DECLINED", mergedOn: null }), // out of scope -> repo-b stays empty
    ];
    const m = computePrsCreatedMatrix(prs, repos, users, SINCE);
    expect(m.colHeaders.map((c) => c.label)).toEqual(["Repo A"]);
    expect(m.cells).toEqual([[1], [0]]);
    expect(m.colTotals).toEqual([1]);
  });

  it("counts the distinct services each engineer opened PRs in", () => {
    const prs = [
      pr({ id: 1, authorAccountId: "u1", repoSlug: "repo-a" }),
      pr({ id: 2, authorAccountId: "u1", repoSlug: "repo-a" }), // same service twice -> still 1
      pr({ id: 3, authorAccountId: "u1", repoSlug: "repo-b" }),
      pr({ id: 4, authorAccountId: "u1", repoSlug: "repo-x" }), // excluded repo -> not counted
    ];
    const m = computePrsCreatedMatrix(prs, repos, users, SINCE);
    expect(m.extraColumn).toEqual({ label: "Services", values: [2, 0] }); // Alice 2, Bob 0
  });
});

describe("PR state scope", () => {
  it("counts merged and open PRs but ignores declined and superseded", () => {
    const prs = [
      pr({ id: 1, repoSlug: "repo-a", state: "MERGED" }),
      pr({ id: 2, repoSlug: "repo-a", state: "OPEN", mergedOn: null }),
      pr({ id: 3, repoSlug: "repo-a", state: "DECLINED", mergedOn: null }),
      pr({ id: 4, repoSlug: "repo-b", state: "SUPERSEDED", mergedOn: null }),
    ];
    const m = computePrsCreatedMatrix(prs, repos, users, SINCE);
    expect(m.cells[0]).toEqual([2]); // Alice: the merged + open one only (repo-b column dropped, all out of scope)
    expect(m.rowTotals[0]).toBe(2);
  });

  it("ignores approvals belonging to declined PRs", () => {
    const prs = [
      pr({ id: 1, authorAccountId: "u1", state: "DECLINED", mergedOn: null }),
      pr({ id: 2, authorAccountId: "u1", state: "MERGED" }),
    ];
    const approvals: ApprovalRecord[] = [
      { repoSlug: "repo-a", prId: 1, approverAccountId: "u2", approvedOn: null }, // declined -> ignored
      { repoSlug: "repo-a", prId: 2, approverAccountId: "u2", approvedOn: null },
    ];
    const m = computeApprovalMatrix(prs, approvals, repos, users, SINCE);
    expect(m.cells).toEqual([[0, 1], [0, 0]]);
  });
});

describe("merged PRs with no approver", () => {
  it("counts merged PRs nobody else approved, per author", () => {
    const prs = [
      pr({ id: 1, authorAccountId: "u1", state: "MERGED" }),                    // approved by Bob
      pr({ id: 2, authorAccountId: "u1", state: "MERGED" }),                    // nobody
      pr({ id: 3, authorAccountId: "u1", state: "MERGED" }),                    // self-approved only
      pr({ id: 4, authorAccountId: "u1", state: "OPEN", mergedOn: null }),      // open, not merged -> not counted
      pr({ id: 5, authorAccountId: "u1", state: "DECLINED", mergedOn: null }),  // declined -> not counted
      pr({ id: 6, authorAccountId: "u2", state: "MERGED" }),                    // Bob's, approved by Alice
    ];
    const approvals: ApprovalRecord[] = [
      { repoSlug: "repo-a", prId: 1, approverAccountId: "u2", approvedOn: null },
      { repoSlug: "repo-a", prId: 3, approverAccountId: "u1", approvedOn: null }, // self-approval
      { repoSlug: "repo-a", prId: 6, approverAccountId: "u1", approvedOn: null },
    ];
    const m = computeApprovalMatrix(prs, approvals, repos, users, SINCE);
    // Alice: PR2 (no approvals) + PR3 (self only) = 2; Bob: 0
    expect(m.extraColumn).toEqual({ label: "Merged, no approval", values: [2, 0] });
  });

  it("is zero for everyone when every merged PR was approved", () => {
    const prs = [pr({ id: 1, authorAccountId: "u1", state: "MERGED" })];
    const approvals: ApprovalRecord[] = [
      { repoSlug: "repo-a", prId: 1, approverAccountId: "u2", approvedOn: null },
    ];
    const m = computeApprovalMatrix(prs, approvals, repos, users, SINCE);
    expect(m.extraColumn?.values).toEqual([0, 0]);
  });
});

describe("row ordering", () => {
  const unordered: UserRecord[] = [
    { accountId: "u2", displayName: "bob", included: true },
    { accountId: "u4", displayName: "Zoe", included: true },
    { accountId: "u1", displayName: "Alice", included: true },
    { accountId: "u3", displayName: "charlie", included: true },
  ];

  it("orders PRs-created rows alphabetically, ignoring case", () => {
    const m = computePrsCreatedMatrix([], repos, unordered, SINCE);
    expect(m.rowUsers.map((u) => u.displayName)).toEqual(["Alice", "bob", "charlie", "Zoe"]);
  });

  it("orders approval rows and approver columns alphabetically, ignoring case", () => {
    const m = computeApprovalMatrix([], [], repos, unordered, SINCE);
    expect(m.rowUsers.map((u) => u.displayName)).toEqual(["Alice", "bob", "charlie", "Zoe"]);
    expect(m.colHeaders.map((c) => c.label)).toEqual(["Alice", "bob", "charlie", "Zoe"]);
  });

  it("keeps cells aligned with the reordered rows", () => {
    // Zoe (last alphabetically, first in input) opened the only PR.
    const prs = [pr({ id: 1, authorAccountId: "u4", repoSlug: "repo-a" })];
    const m = computePrsCreatedMatrix(prs, repos, unordered, SINCE);
    const zoe = m.rowUsers.findIndex((u) => u.displayName === "Zoe");
    expect(m.cells[zoe]).toEqual([1]); // only repo-a has PRs, so it is the only column

    expect(m.rowTotals).toEqual([0, 0, 0, 1]);
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
    const m = computeApprovalMatrix(prs, approvals, repos, users, SINCE);
    // rows = authors, cols = approvers (both included users)
    expect(m.rowUsers.map((u) => u.displayName)).toEqual(["Alice", "Bob"]);
    expect(m.colHeaders.map((c) => c.label)).toEqual(["Alice", "Bob"]);
    // Alice(row) approved-by Bob(col) = 1; Bob(row) approved-by Alice(col) = 1; diagonal 0
    expect(m.cells).toEqual([[0, 1], [1, 0]]);
    expect(m.rowTotals).toEqual([1, 1]);
    expect(m.colTotals).toEqual([1, 1]);
  });
});
