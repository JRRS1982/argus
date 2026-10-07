// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import Highlights from "@/components/Highlights";
import type { InsightsResponse } from "@/types";

// Without this, renders accumulate in the same document and text queries match across tests.
afterEach(cleanup);

describe("Highlights", () => {
  // Regression coverage for the crash a failed /api/insights fetch used to cause:
  // Dashboard used to store the error body (`{ error: "..." }`) as if it were an
  // InsightsResponse, and this component would dereference `insights.prsCreated`
  // on it. With the fetch guard in Dashboard.tsx, a failed fetch now leaves
  // `insights` null instead — this asserts that null renders nothing, never throws.
  it("renders nothing when insights is null, instead of throwing", () => {
    const { container } = render(<Highlights insights={null} />);
    expect(container.firstChild).toBeNull();
  });

  // The user asked for what they SEE, so assert on the rendered card, not just the data.
  const withStamps = (refreshedAt: InsightsResponse["refreshedAt"]): InsightsResponse => {
    const m = { rowUsers: [], colHeaders: [], cells: [], rowTotals: [], colTotals: [] };
    return {
      leaderboard: [], prsCreated: m, approvals: m, window: "6m",
      sinceIso: "2026-04-07T00:00:00.000Z", generatedAt: "2026-10-07T14:02:00.000Z", refreshedAt,
    };
  };

  it("renders each provider on its own line, live GitHub before archived Bitbucket", () => {
    const { container } = render(<Highlights insights={withStamps([
      { provider: "bitbucket", lastSyncedOn: "2026-09-28T13:00:00.000Z", archived: true },
      { provider: "github", lastSyncedOn: "2026-10-07T14:02:00.000Z", archived: false },
    ])} />);
    expect(screen.getByText("archived 28 Sept 2026")).toBeTruthy();
    expect(screen.getByText("7 Oct 2026, 14:02")).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text.indexOf("GitHub")).toBeGreaterThan(-1);
    expect(text.indexOf("GitHub")).toBeLessThan(text.indexOf("Bitbucket"));
  });

  it("renders the single demo line", () => {
    render(<Highlights insights={withStamps([
      { provider: "demo", lastSyncedOn: "2026-10-07T14:02:00.000Z", archived: false },
    ])} />);
    expect(screen.getByText("Demo")).toBeTruthy();
    expect(screen.getByText("7 Oct 2026, 14:02")).toBeTruthy();
  });
});
