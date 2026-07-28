import { describe, it, expect } from "vitest";
import { sixMonthsAgoIso, formatWindowLabel, resolveSinceIso, isInsightsWindow } from "@/lib/window";

describe("sixMonthsAgoIso", () => {
  it("returns the ISO timestamp exactly six months before the given instant", () => {
    expect(sixMonthsAgoIso("2026-06-24T00:00:00.000Z")).toBe("2025-12-24T00:00:00.000Z");
  });

  it("handles month-length underflow by rolling to a valid date", () => {
    // 2026-03-31 minus 6 months -> Sept has 30 days, JS rolls to Oct 1
    const result = sixMonthsAgoIso("2026-03-31T12:00:00.000Z");
    expect(result.startsWith("2025-10-01")).toBe(true);
  });
});

describe("resolveSinceIso", () => {
  const NOW = "2026-07-28T09:00:00.000Z";

  it("uses six months back for the 6m window, ignoring the earliest cached PR", () => {
    expect(resolveSinceIso("6m", NOW, "2022-07-12T00:00:00.000Z")).toBe("2026-01-28T09:00:00.000Z");
  });

  it("reaches back to the oldest cached PR for the all window", () => {
    expect(resolveSinceIso("all", NOW, "2022-07-12T00:00:00.000Z")).toBe("2022-07-12T00:00:00.000Z");
  });

  it("falls back to the epoch when the cache is empty", () => {
    expect(resolveSinceIso("all", NOW, null)).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("isInsightsWindow", () => {
  it("accepts only the two known windows", () => {
    expect(isInsightsWindow("6m")).toBe(true);
    expect(isInsightsWindow("all")).toBe(true);
    expect(isInsightsWindow("12m")).toBe(false);
    expect(isInsightsWindow(null)).toBe(false);
  });
});

describe("formatWindowLabel", () => {
  it("renders the window as a readable UTC date range", () => {
    expect(formatWindowLabel("2026-01-28T00:00:00.000Z", "2026-07-28T07:30:00.000Z"))
      .toBe("28 Jan 2026 – 28 Jul 2026");
  });

  it("uses UTC rather than the local timezone at day boundaries", () => {
    // 23:30 UTC is already the next day in some zones; the label must stay on the UTC day.
    expect(formatWindowLabel("2026-01-31T23:30:00.000Z", "2026-07-31T23:30:00.000Z"))
      .toBe("31 Jan 2026 – 31 Jul 2026");
  });
});
