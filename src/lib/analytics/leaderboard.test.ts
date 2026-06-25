import { describe, it, expect } from "vitest";
import { computeLeaderboard } from "@/lib/analytics/leaderboard";
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

describe("computeLeaderboard", () => {
  it("averages each author's merged-to-main PR review times and sorts fastest-first", () => {
    const prs = [
      pr({ id: 1, authorAccountId: "u1", readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-02T00:00:00.000Z" }), // 1d
      pr({ id: 2, authorAccountId: "u1", readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-04T00:00:00.000Z" }), // 3d -> avg 2d
      pr({ id: 3, authorAccountId: "u2", readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-02T12:00:00.000Z" }), // 1.5d
    ];
    const board = computeLeaderboard(prs, repos, users, SINCE);
    expect(board.map((r) => r.displayName)).toEqual(["Bob", "Alice"]); // Bob 1.5d < Alice 2d
    expect(board[1].prCount).toBe(2);
    expect(board[1].averageReviewMs).toBe(2 * 86_400_000);
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
});
