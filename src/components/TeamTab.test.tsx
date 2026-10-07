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

  it("posts { backfill: true } to /api/sync when Backfill all history is clicked", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === "/api/sync") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ totalPrs: 7, repos: [{}, {}], mode: "fast", backfill: true }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ users: [], repos: [] }),
        } as Response);
      }),
    );

    render(<TeamTab roster={{ users: [], repos: [] }} onRosterChange={vi.fn()} demo={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Backfill all history" }));

    await waitFor(() => {
      expect(screen.getByText(/Synced 7 PRs across 2 repos\./)).toBeTruthy();
    });
    const syncCall = calls.find((c) => c.url === "/api/sync");
    expect(JSON.parse(syncCall!.init!.body as string)).toEqual({ backfill: true });
  });
});

describe("TeamTab skipped repositories", () => {
  const syncResponse = (skipped: unknown[]) => ({
    ok: true,
    json: () => Promise.resolve({ totalPrs: 4, repos: [{}], skipped }),
  }) as Response;

  it("names each skipped repo with a readable reason instead of a raw API URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/sync") {
          return Promise.resolve(syncResponse([
            { provider: "bitbucket", repoKey: "benchmarkme", reason: "Not found (404) — it no longer exists in this workspace.", status: 404, missing: true },
            { provider: "bitbucket", repoKey: "phobos", reason: "Bitbucket is unavailable (503) — try again shortly.", status: 503, missing: false },
          ]));
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ users: [], repos: [] }) } as Response);
      }),
    );

    render(<TeamTab roster={{ users: [], repos: [] }} onRosterChange={vi.fn()} demo={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));

    await waitFor(() => {
      expect(screen.getByText(/benchmarkme/)).toBeTruthy();
    });
    expect(screen.getByText(/no longer exists in this workspace/)).toBeTruthy();
    expect(screen.getByText(/Bitbucket is unavailable/)).toBeTruthy();
    // Only the repo that is genuinely gone gets an untick affordance — a 503 is
    // transient and must never invite the user to drop a repo from the roster.
    expect(screen.getAllByRole("button", { name: /Remove from roster/ })).toHaveLength(1);
  });

  it("unticks a missing repo via the roster API and drops it from the warning", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === "/api/sync") {
          return Promise.resolve(syncResponse([
            { provider: "bitbucket", repoKey: "benchmarkme", reason: "Not found (404).", status: 404, missing: true },
          ]));
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ users: [], repos: [] }) } as Response);
      }),
    );

    render(<TeamTab roster={{ users: [], repos: [] }} onRosterChange={vi.fn()} demo={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Remove from roster/ })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Remove from roster/ }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Remove from roster/ })).toBeNull();
    });
    const patch = calls.find((c) => c.init?.method === "PATCH");
    expect(JSON.parse(patch!.init!.body as string)).toEqual({ kind: "repo", id: "benchmarkme", included: false });
  });
});

describe("TeamTab wholesale sync failure", () => {
  it("offers no removal buttons when not a single repo synced", async () => {
    // A wrong BITBUCKET_WORKSPACE 404s every repo alike. All 3 come back missing,
    // but none of them is actually gone — so none may be offered for removal.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/sync") {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({
              repos: [], totalPrs: 0,
              error: "None of the 3 selected repositories could be refreshed. a: Not found (404).",
              skipped: ["a", "b", "c"].map((repoSlug) => ({
                provider: "bitbucket", repoKey: repoSlug, reason: "Not found (404).", status: 404, missing: true,
              })),
            }),
          } as Response);
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ users: [], repos: [] }) } as Response);
      }),
    );

    render(<TeamTab roster={{ users: [], repos: [] }} onRosterChange={vi.fn()} demo={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));

    await waitFor(() => expect(screen.getByText(/None of the 3 selected repositories/)).toBeTruthy());
    expect(screen.getByText(/3 repositories were skipped/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Remove from roster/ })).toBeNull();
    expect(screen.getByText(/more likely one fault/)).toBeTruthy();
  });
});
