// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import TeamTab from "@/components/TeamTab";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TeamTab", () => {
  // Regression coverage for the reloadRoster half of CRITICAL 1: a non-ok /api/roster
  // response still resolves to JSON (an `{ error }` body), so reloadRoster must check
  // `res.ok` before calling onRosterChange — otherwise the caller's roster state gets
  // overwritten with something that isn't `{ users, repos }`.
  it("does not call onRosterChange when the post-discover roster reload fails", async () => {
    const existingRoster = {
      users: [{ accountId: "u1", displayName: "Alice", included: true }],
      repos: [],
    };
    const onRosterChange = vi.fn();

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url === "/api/discover" && init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ users: 5, repos: 3 }),
          } as Response);
        }
        if (url.startsWith("/api/roster")) {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ error: "boom" }),
          } as Response);
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    render(<TeamTab roster={existingRoster} onRosterChange={onRosterChange} demo={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Discover workspace" }));

    await waitFor(() => {
      expect(screen.getByText(/Discovered 5 users, 3 repos\./)).toBeTruthy();
    });

    expect(onRosterChange).not.toHaveBeenCalled();
  });
});
