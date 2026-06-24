import { describe, it, expect } from "vitest";
import { sixMonthsAgoIso } from "@/lib/window";

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
