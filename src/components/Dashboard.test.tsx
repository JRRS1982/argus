// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import Dashboard from "@/components/Dashboard";

const EMPTY_MATRIX = { rowUsers: [], colHeaders: [], cells: [], rowTotals: [], colTotals: [] };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Regression coverage for CRITICAL 1: a non-ok response from /api/insights or
// /api/roster still resolves its body to JSON (an `{ error }` object), which used to
// get stored as if it were real data and then crash the first thing that read a
// field off it (formatWindowLabel, computeHighlights, roster.users.map). The fix
// gates both fetches on `r.ok` before touching state at all.
describe("Dashboard", () => {
  it("survives a failed /api/insights fetch (e.g. demo-off hitting a read-only filesystem) without crashing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.startsWith("/api/insights")) {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ error: "boom" }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ users: [], repos: [] }),
        } as Response);
      }),
    );

    render(<Dashboard demoAvailable={false} demoDefaultOn={false} />);
    fireEvent.click(screen.getByText("Review-time leaderboard"));

    // If `insights` had been set to `{ error: "boom" }`, this would throw inside
    // LeaderboardTab / formatWindowLabel instead of settling on the empty state.
    await waitFor(() => {
      expect(screen.getByText(/Nothing merged in this window yet/)).toBeTruthy();
    });

    expect(document.body.textContent).not.toMatch(/application error/i);
  });

  it("keeps the previous roster instead of adopting an error body when /api/roster fails", async () => {
    let rosterCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.startsWith("/api/roster")) {
          rosterCalls += 1;
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ error: "boom" }),
          } as Response);
        }
        const insights = {
          leaderboard: [], prsCreated: EMPTY_MATRIX, approvals: EMPTY_MATRIX,
          window: "6m", sinceIso: "2026-01-29T00:00:00.000Z", generatedAt: "2026-07-29T00:00:00.000Z",
        };
        return Promise.resolve({ ok: true, json: () => Promise.resolve(insights) } as Response);
      }),
    );

    render(<Dashboard demoAvailable={false} demoDefaultOn={false} />);

    await waitFor(() => expect(rosterCalls).toBeGreaterThan(0));

    // roster.users stayed an array ([], the initial state) rather than becoming
    // `{ error: "boom" }`, which would have thrown inside TeamTab's `.map`.
    expect(screen.getByText("No users yet — run Discover.")).toBeTruthy();
  });
});
