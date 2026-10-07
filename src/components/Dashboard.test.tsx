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

  it.each([
    ["a refreshed cache", "2026-08-12T09:30:00.000Z", /12 Aug 2026/],
    ["a never-synced cache", null, /run Refresh data on the Team tab/],
  ])("shows the last-refreshed card for %s", async (_name, lastRefreshedAt, expected) => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.startsWith("/api/insights")) {
          const insights = {
            leaderboard: [], prsCreated: EMPTY_MATRIX, approvals: EMPTY_MATRIX,
            window: "6m", sinceIso: "2026-02-13T00:00:00.000Z", generatedAt: "2026-08-13T00:00:00.000Z",
            lastRefreshedAt,
          };
          return Promise.resolve({ ok: true, json: () => Promise.resolve(insights) } as Response);
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ users: [], repos: [] }) } as Response);
      }),
    );

    render(<Dashboard demoAvailable={false} demoDefaultOn={false} />);
    await waitFor(() => {
      expect(screen.getByText(expected)).toBeTruthy();
    });
  });

  it("shows how many PRs the window considers, so refreshes and backfills are visible", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.startsWith("/api/insights")) {
          const insights = {
            leaderboard: [],
            prsCreated: {
              rowUsers: [{ personId: 1, displayName: "Ana" }, { personId: 2, displayName: "Ben" }],
              colHeaders: [{ key: "r1", label: "r1" }],
              cells: [[1200], [34]],
              rowTotals: [1200, 34],
              colTotals: [1234],
            },
            approvals: EMPTY_MATRIX,
            window: "6m", sinceIso: "2026-02-13T00:00:00.000Z", generatedAt: "2026-08-13T00:00:00.000Z",
            lastRefreshedAt: "2026-08-12T09:30:00.000Z",
          };
          return Promise.resolve({ ok: true, json: () => Promise.resolve(insights) } as Response);
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ users: [], repos: [] }) } as Response);
      }),
    );

    render(<Dashboard demoAvailable={false} demoDefaultOn={false} />);
    // Card layout: the label and the count are separate elements.
    await waitFor(() => {
      expect(screen.getByText("PRs considered")).toBeTruthy();
      expect(screen.getByText("1,234")).toBeTruthy();
    });
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
