import { describe, it, expect } from "vitest";
import { buildDemoDataset } from "@/lib/demo/fixture";
import { computeLeaderboard } from "@/lib/analytics/leaderboard";
import { computePrsCreatedMatrix, computeApprovalMatrix } from "@/lib/analytics/matrices";
import { sixMonthsAgoIso } from "@/lib/window";

const NOW = "2026-07-29T12:00:00.000Z";

describe("buildDemoDataset", () => {
  it("is deterministic for the same instant", () => {
    expect(buildDemoDataset(NOW)).toEqual(buildDemoDataset(NOW));
  });

  it("returns five included engineers and five included repos", () => {
    const d = buildDemoDataset(NOW);
    expect(d.users).toHaveLength(5);
    expect(d.repos).toHaveLength(5);
    expect(d.users.every((u) => u.included)).toBe(true);
    expect(d.repos.every((r) => r.included)).toBe(true);
  });

  it("gives every engineer at least one PR", () => {
    const d = buildDemoDataset(NOW);
    for (const u of d.users) {
      expect(d.prs.some((p) => p.authorAccountId === u.accountId)).toBe(true);
    }
  });

  it("targets each repo's main branch so PRs are in scope", () => {
    const d = buildDemoDataset(NOW);
    const mainBySlug = new Map(d.repos.map((r) => [r.slug, r.mainBranch]));
    for (const pr of d.prs) {
      expect(pr.destinationBranch).toBe(mainBySlug.get(pr.repoSlug));
    }
  });

  it("populates every tab on the 6-month window", () => {
    const d = buildDemoDataset(NOW);
    const since = sixMonthsAgoIso(NOW);
    const board = computeLeaderboard(d.prs, d.repos, d.users, since);
    const created = computePrsCreatedMatrix(d.prs, d.repos, d.users, since);
    const approvals = computeApprovalMatrix(d.prs, d.approvals, d.repos, d.users, since);

    expect(board.length).toBeGreaterThan(0);
    expect(created.rowTotals.some((n) => n > 0)).toBe(true);
    expect(approvals.rowTotals.some((n) => n > 0)).toBe(true);
  });

  it("has more history than the 6-month window shows, so All time differs", () => {
    const d = buildDemoDataset(NOW);
    const since = sixMonthsAgoIso(NOW);
    const windowed = computePrsCreatedMatrix(d.prs, d.repos, d.users, since);
    const all = computePrsCreatedMatrix(d.prs, d.repos, d.users, "1970-01-01T00:00:00.000Z");
    const sum = (ns: number[]) => ns.reduce((s, n) => s + n, 0);
    expect(sum(all.rowTotals)).toBeGreaterThan(sum(windowed.rowTotals));
  });

  it("includes merged PRs nobody else approved, so that column is non-zero", () => {
    const d = buildDemoDataset(NOW);
    const approvals = computeApprovalMatrix(
      d.prs, d.approvals, d.repos, d.users, "1970-01-01T00:00:00.000Z",
    );
    expect(approvals.extraColumn).toBeDefined();
    expect(approvals.extraColumn!.values.some((n) => n > 0)).toBe(true);
  });

  it("never self-approves", () => {
    const d = buildDemoDataset(NOW);
    const authorByKey = new Map(d.prs.map((p) => [`${p.repoSlug}#${p.id}`, p.authorAccountId]));
    for (const a of d.approvals) {
      expect(a.approverAccountId).not.toBe(authorByKey.get(`${a.repoSlug}#${a.prId}`));
    }
  });

  it("moves with the reference instant rather than hardcoding dates", () => {
    const later = buildDemoDataset("2027-01-29T12:00:00.000Z");
    const since = sixMonthsAgoIso("2027-01-29T12:00:00.000Z");
    const board = computeLeaderboard(later.prs, later.repos, later.users, since);
    expect(board.length).toBeGreaterThan(0);
  });

  it("contains at least one genuinely open PR", () => {
    const d = buildDemoDataset(NOW);
    expect(d.prs.some((p) => p.state === "OPEN")).toBe(true);
  });

  it("gives open PRs a null mergedOn, preserving the merged/open invariant", () => {
    const d = buildDemoDataset(NOW);
    for (const pr of d.prs.filter((p) => p.state === "OPEN")) {
      expect(pr.mergedOn).toBeNull();
    }
  });

  it("surfaces at least one open PR on the leaderboard's Open column", () => {
    const d = buildDemoDataset(NOW);
    const since = sixMonthsAgoIso(NOW);
    const board = computeLeaderboard(d.prs, d.repos, d.users, since);
    expect(board.some((row) => row.openPrCount > 0)).toBe(true);
  });
});
