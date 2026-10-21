import { describe, it, expect } from "vitest";
import { computePrsCreatedMatrix, computeApprovalMatrix } from "@/lib/analytics/matrices";
import type { PullRequestRecord, ApprovalRecord, Service, Person } from "@/types";

const users: Person[] = [
  { id: 1, displayName: "Alice", included: true, identities: [] },
  { id: 2, displayName: "Bob", included: true, identities: [] },
  { id: 3, displayName: "Excluded", included: false, identities: [] },
];
const repos: Service[] = [
  { id: 1, name: "Repo A", included: true, identities: [{ provider: "bitbucket", repoKey: "repo-a", defaultBranch: "main", groupKey: null, state: "active", lastSyncedOn: null }] },
  { id: 2, name: "Repo B", included: true, identities: [{ provider: "bitbucket", repoKey: "repo-b", defaultBranch: "main", groupKey: null, state: "active", lastSyncedOn: null }] },
  { id: 3, name: "Repo X", included: false, identities: [{ provider: "bitbucket", repoKey: "repo-x", defaultBranch: "main", groupKey: null, state: "active", lastSyncedOn: null }] },
];
const SINCE = "2026-01-01T00:00:00.000Z";

const pr = (over: Partial<PullRequestRecord>): PullRequestRecord => ({
  provider: "bitbucket", number: 1, repoKey: "repo-a", serviceId: 1, personId: 1,
  authorAccountId: "acc-1", title: "T", state: "MERGED",
  createdOn: "2026-02-01T00:00:00.000Z", readyForReviewOn: "2026-02-01T00:00:00.000Z",
  readyForReviewPrecision: "derived", mergedOn: "2026-02-02T00:00:00.000Z",
  mergedOnPrecision: "derived", destinationBranch: "main", url: "https://x/1", ...over,
});

describe("computePrsCreatedMatrix", () => {
  it("counts PRs created per included user per included repo, with totals", () => {
    const prs = [
      pr({ number: 1, personId: 1, repoKey: "repo-a", serviceId: 1 }),
      pr({ number: 2, personId: 1, repoKey: "repo-b", serviceId: 2 }),
      pr({ number: 3, personId: 2, repoKey: "repo-a", serviceId: 1 }),
      pr({ number: 4, personId: 1, repoKey: "repo-x", serviceId: 3 }),                    // excluded repo
      pr({ number: 5, personId: 3, repoKey: "repo-a", serviceId: 1 }),                    // excluded user
      pr({ number: 6, personId: 1, repoKey: "repo-a", serviceId: 1, createdOn: "2025-06-01T00:00:00.000Z" }), // out of window
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
      pr({ number: 1, personId: 1, repoKey: "repo-a", serviceId: 1 }),
      pr({ number: 2, repoKey: "repo-b", serviceId: 2, state: "CLOSED", mergedOn: null }), // out of scope -> repo-b stays empty
    ];
    const m = computePrsCreatedMatrix(prs, repos, users, SINCE);
    expect(m.colHeaders.map((c) => c.label)).toEqual(["Repo A"]);
    expect(m.cells).toEqual([[1], [0]]);
    expect(m.colTotals).toEqual([1]);
  });

  it("counts the distinct services each engineer opened PRs in", () => {
    const prs = [
      pr({ number: 1, personId: 1, repoKey: "repo-a", serviceId: 1 }),
      pr({ number: 2, personId: 1, repoKey: "repo-a", serviceId: 1 }), // same service twice -> still 1
      pr({ number: 3, personId: 1, repoKey: "repo-b", serviceId: 2 }),
      pr({ number: 4, personId: 1, repoKey: "repo-x", serviceId: 3 }), // excluded repo -> not counted
    ];
    const m = computePrsCreatedMatrix(prs, repos, users, SINCE);
    expect(m.extraColumn).toEqual({ label: "Services", values: [2, 0] }); // Alice 2, Bob 0
  });
});

describe("PR state scope", () => {
  it("counts merged and open PRs but ignores declined and superseded", () => {
    const prs = [
      pr({ number: 1, repoKey: "repo-a", serviceId: 1, state: "MERGED" }),
      pr({ number: 2, repoKey: "repo-a", serviceId: 1, state: "OPEN", mergedOn: null }),
      pr({ number: 3, repoKey: "repo-a", serviceId: 1, state: "CLOSED", mergedOn: null }),
      pr({ number: 4, repoKey: "repo-b", serviceId: 2, state: "CLOSED", mergedOn: null }),
    ];
    const m = computePrsCreatedMatrix(prs, repos, users, SINCE);
    expect(m.cells[0]).toEqual([2]); // Alice: the merged + open one only (repo-b column dropped, all out of scope)
    expect(m.rowTotals[0]).toBe(2);
  });

  it("ignores approvals belonging to declined PRs", () => {
    const prs = [
      pr({ number: 1, personId: 1, state: "CLOSED", mergedOn: null }),
      pr({ number: 2, personId: 1, state: "MERGED" }),
    ];
    const approvals: ApprovalRecord[] = [
      { provider: "bitbucket", repoKey: "repo-a", prNumber: 1, approverAccountId: "u2", personId: 2, approvedOn: null }, // declined -> ignored
      { provider: "bitbucket", repoKey: "repo-a", prNumber: 2, approverAccountId: "u2", personId: 2, approvedOn: null },
    ];
    const m = computeApprovalMatrix(prs, approvals, repos, users, SINCE);
    expect(m.cells).toEqual([[0, 1], [0, 0]]);
  });
});

describe("merged PRs with no approver", () => {
  it("counts merged PRs nobody else approved, per author", () => {
    const prs = [
      pr({ number: 1, personId: 1, state: "MERGED" }),                    // approved by Bob
      pr({ number: 2, personId: 1, state: "MERGED" }),                    // nobody
      pr({ number: 3, personId: 1, state: "MERGED" }),                    // self-approved only
      pr({ number: 4, personId: 1, state: "OPEN", mergedOn: null }),      // open, not merged -> not counted
      pr({ number: 5, personId: 1, state: "CLOSED", mergedOn: null }),  // declined -> not counted
      pr({ number: 6, personId: 2, state: "MERGED" }),                    // Bob's, approved by Alice
    ];
    const approvals: ApprovalRecord[] = [
      { provider: "bitbucket", repoKey: "repo-a", prNumber: 1, approverAccountId: "u2", personId: 2, approvedOn: null },
      { provider: "bitbucket", repoKey: "repo-a", prNumber: 3, approverAccountId: "u1", personId: 1, approvedOn: null }, // self-approval
      { provider: "bitbucket", repoKey: "repo-a", prNumber: 6, approverAccountId: "u1", personId: 1, approvedOn: null },
    ];
    const m = computeApprovalMatrix(prs, approvals, repos, users, SINCE);
    // Alice: PR2 (no approvals) + PR3 (self only) = 2; Bob: 0
    expect(m.extraColumn).toEqual({ label: "Merged, no approval", values: [2, 0] });
  });

  it("is zero for everyone when every merged PR was approved", () => {
    const prs = [pr({ number: 1, personId: 1, state: "MERGED" })];
    const approvals: ApprovalRecord[] = [
      { provider: "bitbucket", repoKey: "repo-a", prNumber: 1, approverAccountId: "u2", personId: 2, approvedOn: null },
    ];
    const m = computeApprovalMatrix(prs, approvals, repos, users, SINCE);
    expect(m.extraColumn?.values).toEqual([0, 0]);
  });
});

describe("row ordering", () => {
  const unordered: Person[] = [
    { id: 2, displayName: "bob", included: true, identities: [] },
    { id: 4, displayName: "Zoe", included: true, identities: [] },
    { id: 1, displayName: "Alice", included: true, identities: [] },
    { id: 3, displayName: "charlie", included: true, identities: [] },
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
    const prs = [pr({ number: 1, personId: 4, repoKey: "repo-a", serviceId: 1 })];
    const m = computePrsCreatedMatrix(prs, repos, unordered, SINCE);
    const zoe = m.rowUsers.findIndex((u) => u.displayName === "Zoe");
    expect(m.cells[zoe]).toEqual([1]); // only repo-a has PRs, so it is the only column

    expect(m.rowTotals).toEqual([0, 0, 0, 1]);
  });
});

describe("computeApprovalMatrix", () => {
  it("counts how often each author's PRs were approved by each approver, excluding self-approval", () => {
    const prs = [
      pr({ number: 1, personId: 1 }),
      pr({ number: 2, personId: 2 }),
    ];
    const approvals: ApprovalRecord[] = [
      { provider: "bitbucket", repoKey: "repo-a", prNumber: 1, approverAccountId: "u2", personId: 2, approvedOn: null }, // Bob approved Alice's PR1
      { provider: "bitbucket", repoKey: "repo-a", prNumber: 1, approverAccountId: "u1", personId: 1, approvedOn: null }, // self-approval -> ignored
      { provider: "bitbucket", repoKey: "repo-a", prNumber: 2, approverAccountId: "u1", personId: 1, approvedOn: null }, // Alice approved Bob's PR2
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
