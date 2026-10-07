import { describe, it, expect } from "vitest";
import { computeLeaderboard } from "@/lib/analytics/leaderboard";
import { computePrsCreatedMatrix } from "@/lib/analytics/matrices";
import type { PullRequestRecord, Service, Person } from "@/types";

const repos: Service[] = [
  { id: 1, name: "Repo A", included: true, identities: [{ provider: "bitbucket", repoKey: "repo-a", defaultBranch: "main", groupKey: null, state: "active", lastSyncedOn: null }] },
];
const users: Person[] = [
  { id: 1, displayName: "Alice", included: true, identities: [] },
  { id: 2, displayName: "Bob", included: true, identities: [] },
  { id: 3, displayName: "Excluded", included: false, identities: [] },
];

const pr = (over: Partial<PullRequestRecord>): PullRequestRecord => ({
  provider: "bitbucket", number: 1, repoKey: "repo-a", serviceId: 1, personId: 1, title: "T", state: "MERGED",
  createdOn: "2026-02-01T00:00:00.000Z", readyForReviewOn: "2026-02-01T00:00:00.000Z",
  readyForReviewPrecision: "derived", mergedOn: "2026-02-02T00:00:00.000Z",
  mergedOnPrecision: "derived", destinationBranch: "main", url: "https://x/1", ...over,
});

const SINCE = "2026-01-01T00:00:00.000Z";

const DAY = 86_400_000;

describe("computeLeaderboard", () => {
  it("averages each author's merged-to-main PR review times and orders rows alphabetically", () => {
    const prs = [
      pr({ number: 1, personId: 1, readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-02T00:00:00.000Z" }), // 1d
      pr({ number: 2, personId: 1, readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-04T00:00:00.000Z" }), // 3d -> avg 2d
      pr({ number: 3, personId: 2, readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-02T12:00:00.000Z" }), // 1.5d
    ];
    const board = computeLeaderboard(prs, repos, users, SINCE);
    expect(board.map((r) => r.displayName)).toEqual(["Alice", "Bob"]); // alphabetical, despite Bob (1.5d) being faster than Alice (2d)
    expect(board[0].prCount).toBe(2);
    expect(board[0].averageReviewMs).toBe(2 * DAY);
  });

  it("reports a median that ignores outliers", () => {
    const prs = [
      // Alice: 1d, 1d, 30d -> median 1d, average ~10.7d (one stale PR skews the mean)
      pr({ number: 1, personId: 1, readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-02T00:00:00.000Z" }),
      pr({ number: 2, personId: 1, readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-02T00:00:00.000Z" }),
      pr({ number: 3, personId: 1, readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-03-03T00:00:00.000Z" }),
      // Bob: 2d, 4d -> median 3d, average 3d
      pr({ number: 4, personId: 2, readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-03T00:00:00.000Z" }),
      pr({ number: 5, personId: 2, readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-05T00:00:00.000Z" }),
    ];
    const board = computeLeaderboard(prs, repos, users, SINCE);
    const alice = board.find((r) => r.displayName === "Alice")!;
    const bob = board.find((r) => r.displayName === "Bob")!;

    expect(alice.medianReviewMs).toBe(1 * DAY);          // odd count -> middle value
    expect(bob.medianReviewMs).toBe(3 * DAY);            // even count -> mean of the two middles
    expect(alice.averageReviewMs).toBeGreaterThan(bob.averageReviewMs);
  });

  it("honours repo include/exclude toggles, like the matrices do", () => {
    const withExcluded: Service[] = [
      ...repos,
      { id: 3, name: "Repo X", included: false, identities: [{ provider: "bitbucket", repoKey: "repo-x", defaultBranch: "main", groupKey: null, state: "active", lastSyncedOn: null }] },
    ];
    const prs = [
      pr({ number: 1, repoKey: "repo-a", serviceId: 1 }),
      pr({ number: 2, repoKey: "repo-x", serviceId: 3 }), // excluded repo -> must not count
    ];
    const [alice] = computeLeaderboard(prs, withExcluded, users, SINCE);
    expect(alice.prCount).toBe(1);
    expect(alice.prs.map((p) => p.repoKey)).toEqual(["repo-a"]);
  });

  it("reports open PRs so merged + open reconciles with the PRs-created matrix", () => {
    const prs = [
      pr({ number: 1, personId: 1, state: "MERGED" }),
      pr({ number: 2, personId: 1, state: "OPEN", mergedOn: null }),
      pr({ number: 3, personId: 1, state: "OPEN", mergedOn: null }),
      pr({ number: 4, personId: 1, state: "CLOSED", mergedOn: null }),      // abandoned, counted nowhere
      pr({ number: 5, personId: 1, state: "OPEN", mergedOn: null, destinationBranch: "develop" }), // not main
    ];
    const [alice] = computeLeaderboard(prs, repos, users, SINCE);
    expect(alice.prCount).toBe(1);
    expect(alice.openPrCount).toBe(2);

    // Same population as the created matrix: 1 merged + 2 open = 3.
    const created = computePrsCreatedMatrix(prs, repos, users, SINCE);
    const aliceRow = created.rowUsers.findIndex((u) => u.personId === 1);
    expect(created.rowTotals[aliceRow]).toBe(alice.prCount + alice.openPrCount);
  });

  it("excludes non-merged, non-main, out-of-window PRs and excluded users", () => {
    const prs = [
      pr({ number: 1, personId: 1 }),
      pr({ number: 2, personId: 1, state: "OPEN", mergedOn: null }),       // not merged
      pr({ number: 3, personId: 1, destinationBranch: "feature" }),        // not main
      pr({ number: 4, personId: 1, mergedOn: "2025-06-01T00:00:00.000Z" }), // before window
      pr({ number: 5, personId: 3 }),                                       // excluded user
    ];
    const board = computeLeaderboard(prs, repos, users, SINCE);
    expect(board).toHaveLength(1);
    expect(board[0].displayName).toBe("Alice");
    expect(board[0].prCount).toBe(1);
  });

  it("sorts each author's PR list slowest-first and flags fallbacks", () => {
    const prs = [
      pr({ number: 1, readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-02T00:00:00.000Z", readyForReviewPrecision: "derived" }),
      pr({ number: 2, readyForReviewOn: "2026-02-01T00:00:00.000Z", mergedOn: "2026-02-05T00:00:00.000Z", readyForReviewPrecision: "fallback" }),
    ];
    const [alice] = computeLeaderboard(prs, repos, users, SINCE);
    expect(alice.prs.map((p) => p.number)).toEqual([2, 1]); // slowest first
    expect(alice.prs[0].readyIsFallback).toBe(true);
  });

  it("orders engineers by name, not by speed, so the table is not a scoreboard", () => {
    const repos: Service[] = [
      { id: 1, name: "r1", included: true, identities: [{ provider: "bitbucket", repoKey: "r1", defaultBranch: "main", groupKey: null, state: "active", lastSyncedOn: null }] },
    ];
    const users: Person[] = [
      { id: 1, displayName: "Zara", included: true, identities: [] },
      { id: 2, displayName: "adam", included: true, identities: [] },
      { id: 3, displayName: "Mira", included: true, identities: [] },
    ];
    const pr = (number: number, personId: number, days: number): PullRequestRecord => ({
      provider: "bitbucket", number, repoKey: "r1", serviceId: 1, personId, title: `pr ${number}`, state: "MERGED",
      createdOn: "2026-01-01T00:00:00.000Z",
      readyForReviewOn: "2026-01-01T00:00:00.000Z",
      readyForReviewPrecision: "fallback",
      mergedOn: new Date(Date.UTC(2026, 0, 1 + days)).toISOString(),
      mergedOnPrecision: "derived",
      destinationBranch: "main",
      url: "https://example.com",
    });
    // Zara is fastest, adam slowest — so speed order and name order disagree.
    const prs = [pr(1, 1, 1), pr(2, 2, 9), pr(3, 3, 5)];

    const rows = computeLeaderboard(prs, repos, users, "2025-01-01T00:00:00.000Z");
    expect(rows.map((r) => r.displayName)).toEqual(["adam", "Mira", "Zara"]);
  });
});
