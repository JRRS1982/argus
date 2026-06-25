import { describe, it, expect } from "vitest";
import { reviewDurationMs } from "@/lib/analytics/duration";

describe("reviewDurationMs", () => {
  it("returns the millisecond gap between ready and merge", () => {
    expect(reviewDurationMs({
      readyForReviewOn: "2026-01-01T00:00:00.000Z",
      mergedOn: "2026-01-02T00:00:00.000Z",
    })).toBe(86_400_000);
  });

  it("returns null when the PR is not merged", () => {
    expect(reviewDurationMs({ readyForReviewOn: "2026-01-01T00:00:00.000Z", mergedOn: null })).toBeNull();
  });

  it("clamps negative durations (merge before ready) to 0", () => {
    expect(reviewDurationMs({
      readyForReviewOn: "2026-01-02T00:00:00.000Z",
      mergedOn: "2026-01-01T00:00:00.000Z",
    })).toBe(0);
  });
});
