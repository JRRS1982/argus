import { describe, it, expect } from "vitest";
import { computeHighlights } from "@/lib/analytics/highlights";
import type { InsightsResponse } from "@/types";

const base: InsightsResponse = {
  leaderboard: [
    { accountId: "u1", displayName: "Ana", prCount: 3, openPrCount: 0,
      averageReviewMs: 9_000_000, medianReviewMs: 7_200_000, prs: [] },
    { accountId: "u2", displayName: "Ben", prCount: 2, openPrCount: 1,
      averageReviewMs: 5_000_000, medianReviewMs: 3_600_000, prs: [] },
  ],
  prsCreated: {
    rowUsers: [{ accountId: "u1", displayName: "Ana" }, { accountId: "u2", displayName: "Ben" }],
    colHeaders: [{ key: "r1", label: "r1" }, { key: "r2", label: "r2" }],
    cells: [[1, 1], [2, 0]],
    rowTotals: [2, 2],
    colTotals: [3, 1],
    extraColumn: { label: "Services", values: [2, 1] },
  },
  approvals: {
    rowUsers: [{ accountId: "u1", displayName: "Ana" }, { accountId: "u2", displayName: "Ben" }],
    colHeaders: [{ key: "u1", label: "Ana" }, { key: "u2", label: "Ben" }],
    cells: [[0, 4], [1, 0]],
    rowTotals: [4, 1],
    colTotals: [1, 4],
    extraColumn: { label: "Merged, no approval", values: [0, 0] },
  },
  window: "6m",
  sinceIso: "2026-01-29T00:00:00.000Z",
  generatedAt: "2026-07-29T00:00:00.000Z",
};

describe("computeHighlights", () => {
  it("names the engineer who touched the most services", () => {
    const h = computeHighlights(base).find((x) => x.key === "services");
    expect(h?.engineer).toBe("Ana");
    expect(h?.value).toBe("2");
  });

  it("names the most generous approver, by approvals given", () => {
    const h = computeHighlights(base).find((x) => x.key === "approvals");
    expect(h?.engineer).toBe("Ben"); // column total 4
  });

  it("names the fastest median, not the slowest", () => {
    const h = computeHighlights(base).find((x) => x.key === "median");
    expect(h?.engineer).toBe("Ben"); // 3.6e6 ms < 7.2e6 ms
  });

  it("omits categories with no data rather than showing them empty", () => {
    const empty: InsightsResponse = {
      ...base,
      leaderboard: [],
      prsCreated: { ...base.prsCreated, extraColumn: { label: "Services", values: [0, 0] } },
      approvals: { ...base.approvals, colTotals: [0, 0] },
    };
    expect(computeHighlights(empty)).toEqual([]);
  });
});
