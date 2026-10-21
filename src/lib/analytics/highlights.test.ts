import { describe, it, expect } from "vitest";
import { computeHighlights } from "@/lib/analytics/highlights";
import type { InsightsResponse } from "@/types";

const base: InsightsResponse = {
  leaderboard: [
    { personId: 1, displayName: "Ana", prCount: 3, openPrCount: 0,
      averageReviewMs: 9_000_000, medianReviewMs: 7_200_000, prs: [] },
    { personId: 2, displayName: "Ben", prCount: 2, openPrCount: 1,
      averageReviewMs: 5_000_000, medianReviewMs: 3_600_000, prs: [] },
  ],
  prsCreated: {
    rowUsers: [{ personId: 1, displayName: "Ana" }, { personId: 2, displayName: "Ben" }],
    colHeaders: [{ key: "r1", label: "r1" }, { key: "r2", label: "r2" }],
    cells: [[1, 1], [2, 0]],
    rowTotals: [2, 2],
    colTotals: [3, 1],
    extraColumn: { label: "Services", values: [2, 1] },
  },
  approvals: {
    rowUsers: [{ personId: 1, displayName: "Ana" }, { personId: 2, displayName: "Ben" }],
    colHeaders: [{ key: "u1", label: "Ana" }, { key: "u2", label: "Ben" }],
    cells: [[0, 4], [1, 0]],
    rowTotals: [4, 1],
    colTotals: [1, 4],
    extraColumn: { label: "Merged, no approval", values: [0, 0] },
  },
  window: "6m",
  sinceIso: "2026-01-29T00:00:00.000Z",
  generatedAt: "2026-07-29T00:00:00.000Z",
  refreshedAt: [{ provider: "github", lastSyncedOn: "2026-07-29T00:00:00.000Z", archived: false }],
};

describe("computeHighlights", () => {
  it("leads with how many PRs the window considers, so refreshes and backfills are visible", () => {
    const [first] = computeHighlights(base);
    expect(first.key).toBe("prs");
    expect(first.engineer).toBe("4"); // sum of prsCreated row totals
  });

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

  it("ends with the freshness card, or a prompt when nothing ever synced", () => {
    const cards = computeHighlights(base);
    const last = cards[cards.length - 1];
    expect(last.key).toBe("refreshed");
    expect(last.lines).toEqual([{ label: "GitHub", value: "29 Jul 2026, 00:00" }]);

    const never = computeHighlights({ ...base, refreshedAt: [] });
    expect(never[never.length - 1].engineer).toBe("Never");
    expect(never[never.length - 1].lines).toBeUndefined();
  });

  it("lists each provider's freshness separately, live before archived", () => {
    const cards = computeHighlights({ ...base, refreshedAt: [
      { provider: "bitbucket", lastSyncedOn: "2026-09-28T13:00:00.000Z", archived: true },
      { provider: "github", lastSyncedOn: "2026-10-07T14:02:00.000Z", archived: false },
    ] });
    expect(cards.find((c) => c.key === "refreshed")!.lines).toEqual([
      // "archived", never "last pulled": Bitbucket will never pull again.
      { label: "GitHub", value: "7 Oct 2026, 14:02" },
      { label: "Bitbucket", value: "archived 28 Sept 2026" },
    ]);
  });

  it("omits a provider that has never synced rather than showing Never", () => {
    const cards = computeHighlights({ ...base, refreshedAt: [
      { provider: "github", lastSyncedOn: "2026-10-07T14:02:00.000Z", archived: false },
    ] });
    expect(cards.find((c) => c.key === "refreshed")!.lines).toHaveLength(1);
  });

  it("shows the generation instant as one line in demo mode", () => {
    const cards = computeHighlights({ ...base, refreshedAt: [
      { provider: "demo", lastSyncedOn: "2026-10-07T14:02:00.000Z", archived: false },
    ] });
    expect(cards.find((c) => c.key === "refreshed")!.lines).toEqual([
      { label: "Demo", value: "7 Oct 2026, 14:02" },
    ]);
  });

  it("omits recognition categories with no data, but always keeps the context cards", () => {
    const empty: InsightsResponse = {
      ...base,
      leaderboard: [],
      prsCreated: { ...base.prsCreated, extraColumn: { label: "Services", values: [0, 0] } },
      approvals: { ...base.approvals, colTotals: [0, 0] },
    };
    expect(computeHighlights(empty).map((x) => x.key)).toEqual(["prs", "refreshed"]);
  });
});
