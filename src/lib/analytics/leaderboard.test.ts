import { describe, it, expect } from "vitest";
import { computeLeaderboard } from "@/lib/analytics/leaderboard";
import { computePrsCreatedMatrix } from "@/lib/analytics/matrices";
import type { PullRequestRecord, RepoRecord, UserRecord } from "@/types";

const repos: RepoRecord[] = [
  { slug: "repo-a", name: "Repo A", projectKey: null, mainBranch: "main", included: true },
];
const users: UserRecord[] = [
  { accountId: "u1", displayName: "Alice", included: true },
  { accountId: "u2", displayName: "Bob", included: true },
  { accountId: "u3", displayName: "Excluded", included: false },
];

const pr = (over: Partial<PullRequestRecord>): PullRequestRecord => ({
  id: 1, repoSlug: "repo-a", authorAccountId: "u1", title: "T", state: "MERGED",
  createdOn: "2026-02-01T00:00:00.000Z", readyForReviewOn: "2026-02-01T00:00:00.000Z",
  readyIsFallback: false, mergedOn: "2026-02-02T00:00:00.000Z",
  destinationBranch: "main", url: "https://x/1", ...over,
});

const SINCE = "2026-01-01T00:00:00.000Z";

const DAY = 86_400_000;

describe("computeLeaderboard", () => {
  it("averages each author's merged-to-main PR review times and orders rows alphabetically", () => {
    const prs = [
      pr({ id: 1, authorAccountId: "u1", readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-02T00:00:00.000Z" }), // 1d
      pr({ id: 2, authorAccountId: "u1", readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-04T00:00:00.000Z" }), // 3d -> avg 2d
      pr({ id: 3, authorAccountId: "u2", readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-02T12:00:00.000Z" }), // 1.5d
    ];
    const board = computeLeaderboard(prs, repos, users, SINCE);
    expect(board.map((r) => r.displayName)).toEqual(["Alice", "Bob"]); // alphabetical, despite Bob (1.5d) being faster than Alice (2d)
    expect(board[0].prCount).toBe(2);
    expect(board[0].averageReviewMs).toBe(2 * DAY);
  });

  it("reports a median that ignores outliers, independent of row order", () => {
    const prs = [
      // Alice: 1d, 1d, 30d -> median 1d, average ~10.7d (one stale PR skews the mean)
      pr({ id: 1, authorAccountId: "u1", readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-02T00:00:00.000Z" }),
      pr({ id: 2, authorAccountId: "u1", readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-02T00:00:00.000Z" }),
      pr({ id: 3, authorAccountId: "u1", readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-03-03T00:00:00.000Z" }),
      // Bob: 2d, 4d -> median 3d, average 3d
      pr({ id: 4, authorAccountId: "u2", readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-03T00:00:00.000Z" }),
      pr({ id: 5, authorAccountId: "u2", readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-05T00:00:00.000Z" }),
    ];
    const board = computeLeaderboard(prs, repos, users, SINCE);
    const alice = board.find((r) => r.displayName === "Alice")!;
    const bob = board.find((r) => r.displayName === "Bob")!;

    expect(alice.medianReviewMs).toBe(1 * DAY);          // odd count -> middle value
    expect(bob.medianReviewMs).toBe(3 * DAY);            // even count -> mean of the two middles
    expect(alice.averageReviewMs).toBeGreaterThan(bob.averageReviewMs);
    expect(board.map((r) => r.displayName)).toEqual(["Alice", "Bob"]); // alphabetical, not ranked by median or average
  });

  it("honours repo include/exclude toggles, like the matrices do", () => {
    const withExcluded: RepoRecord[] = [
      ...repos,
      { slug: "repo-x", name: "Repo X", projectKey: null, mainBranch: "main", included: false },
    ];
    const prs = [
      pr({ id: 1, repoSlug: "repo-a" }),
      pr({ id: 2, repoSlug: "repo-x" }), // excluded repo -> must not count
    ];
    const [alice] = computeLeaderboard(prs, withExcluded, users, SINCE);
    expect(alice.prCount).toBe(1);
    expect(alice.prs.map((p) => p.repoSlug)).toEqual(["repo-a"]);
  });

  it("reports open PRs so merged + open reconciles with the PRs-created matrix", () => {
    const prs = [
      pr({ id: 1, authorAccountId: "u1", state: "MERGED" }),
      pr({ id: 2, authorAccountId: "u1", state: "OPEN", mergedOn: null }),
      pr({ id: 3, authorAccountId: "u1", state: "OPEN", mergedOn: null }),
      pr({ id: 4, authorAccountId: "u1", state: "DECLINED", mergedOn: null }),      // abandoned, counted nowhere
      pr({ id: 5, authorAccountId: "u1", state: "OPEN", mergedOn: null, destinationBranch: "develop" }), // not main
    ];
    const [alice] = computeLeaderboard(prs, repos, users, SINCE);
    expect(alice.prCount).toBe(1);
    expect(alice.openPrCount).toBe(2);

    // Same population as the created matrix: 1 merged + 2 open = 3.
    const created = computePrsCreatedMatrix(prs, repos, users, SINCE);
    const aliceRow = created.rowUsers.findIndex((u) => u.accountId === "u1");
    expect(created.rowTotals[aliceRow]).toBe(alice.prCount + alice.openPrCount);
  });

  it("excludes non-merged, non-main, out-of-window PRs and excluded users", () => {
    const prs = [
      pr({ id: 1, authorAccountId: "u1" }),
      pr({ id: 2, authorAccountId: "u1", state: "OPEN", mergedOn: null }),       // not merged
      pr({ id: 3, authorAccountId: "u1", destinationBranch: "feature" }),        // not main
      pr({ id: 4, authorAccountId: "u1", mergedOn: "2025-06-01T00:00:00.000Z" }), // before window
      pr({ id: 5, authorAccountId: "u3" }),                                       // excluded user
    ];
    const board = computeLeaderboard(prs, repos, users, SINCE);
    expect(board).toHaveLength(1);
    expect(board[0].displayName).toBe("Alice");
    expect(board[0].prCount).toBe(1);
  });

  it("sorts each author's PR list slowest-first and flags fallbacks", () => {
    const prs = [
      pr({ id: 1, readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-02T00:00:00.000Z", readyIsFallback: false }),
      pr({ id: 2, readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-05T00:00:00.000Z", readyIsFallback: true }),
    ];
    const [alice] = computeLeaderboard(prs, repos, users, SINCE);
    expect(alice.prs.map((p) => p.id)).toEqual([2, 1]); // slowest first
    expect(alice.prs[0].readyIsFallback).toBe(true);
  });

  it("orders engineers by name, not by speed, so the table is not a scoreboard", () => {
    const repos: RepoRecord[] = [
      { slug: "r1", name: "r1", projectKey: null, mainBranch: "main", included: true },
    ];
    const users: UserRecord[] = [
      { accountId: "u1", displayName: "Zara", included: true },
      { accountId: "u2", displayName: "adam", included: true },
      { accountId: "u3", displayName: "Mira", included: true },
    ];
    const pr = (id: number, author: string, days: number): PullRequestRecord => ({
      id, repoSlug: "r1", authorAccountId: author, title: `pr ${id}`, state: "MERGED",
      createdOn: "2026-01-01T00:00:00.000Z",
      readyForReviewOn: "2026-01-01T00:00:00.000Z",
      readyIsFallback: true,
      mergedOn: new Date(Date.UTC(2026, 0, 1 + days)).toISOString(),
      destinationBranch: "main",
      url: "https://example.com",
    });
    // Zara is fastest, adam slowest — so speed order and name order disagree.
    const prs = [pr(1, "u1", 1), pr(2, "u2", 9), pr(3, "u3", 5)];

    const rows = computeLeaderboard(prs, repos, users, "2025-01-01T00:00:00.000Z");
    expect(rows.map((r) => r.displayName)).toEqual(["adam", "Mira", "Zara"]);
  });
});
