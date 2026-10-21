// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import TeamTab from "@/components/TeamTab";
import type { Person, Service } from "@/types";

const svc = (over: Partial<Service> = {}): Service => ({
  id: 1, name: "Repo A", included: true,
  identities: [{
    provider: "github", repoKey: "repo-a", defaultBranch: "main",
    groupKey: null, state: "active", lastSyncedOn: null,
  }],
  ...over,
});
const person = (over: Partial<Person> = {}): Person => ({
  id: 1, displayName: "Alice", included: true,
  identities: [{ provider: "bitbucket", accountId: "u1" }], ...over,
});

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
      people: [{ id: 1, displayName: "Alice", included: true, identities: [{ provider: "bitbucket" as const, accountId: "u1" }] }],
      services: [],
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

    render(<TeamTab roster={{ people: [], services: [] }} onRosterChange={vi.fn()} demo={false} />);
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
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ people: [], services: [] }) } as Response);
      }),
    );

    const idn = (repoKey: string, state: "missing" | "active") => ({
      provider: "bitbucket" as const, repoKey, defaultBranch: "main", groupKey: null, state, lastSyncedOn: null,
    });
    render(<TeamTab roster={{ people: [], services: [
      svc({ id: 1, name: "benchmarkme", identities: [idn("benchmarkme", "missing")] }),
      svc({ id: 2, name: "phobos", identities: [idn("phobos", "active")] }),
    ] }} onRosterChange={vi.fn()} demo={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));

    await waitFor(() => {
      expect(screen.getByText(/no longer exists in this workspace/)).toBeTruthy();
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
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ people: [], services: [] }) } as Response);
      }),
    );

    const gone = svc({ id: 9, name: "benchmarkme", identities: [{
      provider: "bitbucket", repoKey: "benchmarkme", defaultBranch: "main", groupKey: null, state: "missing", lastSyncedOn: null,
    }] });
    render(<TeamTab roster={{ people: [], services: [gone] }} onRosterChange={vi.fn()} demo={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Remove from roster/ })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Remove from roster/ }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Remove from roster/ })).toBeNull();
    });
    const patch = calls.find((c) => c.init?.method === "PATCH");
    expect(JSON.parse(patch!.init!.body as string)).toEqual({ kind: "service", id: 9, included: false });
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
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ people: [], services: [] }) } as Response);
      }),
    );

    render(<TeamTab roster={{ people: [], services: [] }} onRosterChange={vi.fn()} demo={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));

    await waitFor(() => expect(screen.getByText(/None of the 3 selected repositories/)).toBeTruthy());
    expect(screen.getByText(/3 repositories were skipped/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Remove from roster/ })).toBeNull();
    expect(screen.getByText(/more likely one fault/)).toBeTruthy();
  });
});

const ident = (provider: "bitbucket" | "github", repoKey: string, state: "active" | "archived" | "missing") =>
  ({ provider, repoKey, defaultBranch: "main", groupKey: null, state, lastSyncedOn: null });

describe("TeamTab roster ordering and badges", () => {
  it("lists included services above excluded ones, alphabetical within each group", () => {
    render(<TeamTab roster={{ people: [], services: [
      svc({ id: 1, name: "zebra", included: true }),
      svc({ id: 2, name: "alpha", included: false }),
      svc({ id: 3, name: "beta", included: true }),
    ] }} />);
    // With 768 discovered services an unordered list is unusable: what you have
    // chosen must be visible without scrolling past hundreds you have not.
    expect(screen.getAllByRole("checkbox").map((c) => c.getAttribute("aria-label")))
      .toEqual(["beta", "zebra", "alpha"]);
  });

  it("orders people the same way, case-insensitively", () => {
    render(<TeamTab roster={{ services: [], people: [
      person({ id: 1, displayName: "Zoe", included: false }),
      person({ id: 2, displayName: "bob", included: true }),
      person({ id: 3, displayName: "Andy", included: true }),
      person({ id: 4, displayName: "carol", included: false }),
    ] }} />);
    expect(screen.getAllByRole("checkbox").map((c) => c.getAttribute("aria-label")))
      .toEqual(["Andy", "bob", "carol", "Zoe"]);
  });

  it("shows a badge per provider identity", () => {
    render(<TeamTab roster={{ people: [], services: [svc({
      identities: [ident("bitbucket", "repo-a", "archived"), ident("github", "repo-a", "active")],
    })] }} />);
    expect(screen.getByTitle(/Bitbucket.*archived/i)).toBeTruthy();
    expect(screen.getByTitle(/GitHub.*active/i)).toBeTruthy();
  });
});

describe("TeamTab removal safety", () => {
  const skip = (provider: "bitbucket" | "github", repoKey: string) =>
    ({ provider, repoKey, reason: "Not found (404).", status: 404, missing: true });

  // Archived Bitbucket history is irreplaceable and cannot be re-fetched.
  it("does not offer removal for a service whose only identity is archived", () => {
    render(<TeamTab anyRepoSucceeded skipped={[skip("github", "repo-a")]}
      roster={{ people: [], services: [svc({ identities: [ident("bitbucket", "repo-a", "archived")] })] }} />);
    expect(screen.queryByRole("button", { name: /remove from roster/i })).toBeNull();
  });

  it("does not offer removal when a missing GitHub identity sits beside archived Bitbucket history", () => {
    render(<TeamTab anyRepoSucceeded skipped={[skip("github", "repo-a")]}
      roster={{ people: [], services: [svc({
        identities: [ident("bitbucket", "repo-a", "archived"), ident("github", "repo-a", "missing")],
      })] }} />);
    expect(screen.queryByRole("button", { name: /remove from roster/i })).toBeNull();
  });

  it("removes a GitHub-only service by canonical id", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ people: [], services: [] }) } as Response);
    }));
    render(<TeamTab anyRepoSucceeded skipped={[skip("github", "repo-a")]}
      roster={{ people: [], services: [svc({ id: 42, identities: [ident("github", "repo-a", "missing")] })] }} />);
    fireEvent.click(screen.getByRole("button", { name: /remove from roster/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /remove from roster/i })).toBeNull());
    expect(JSON.parse(calls.find((c) => c.init?.method === "PATCH")!.init!.body as string))
      .toEqual({ kind: "service", id: 42, included: false });
  });
});

describe("TeamTab merge control and hints", () => {
  const okFetch = () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ people: [], services: [] }) } as Response);
    }));
    return calls;
  };

  it("merges an unlinked identity into another entry by canonical id", async () => {
    const calls = okFetch();
    render(<TeamTab roster={{ people: [], services: [
      svc({ id: 1, name: "benchmarkme", identities: [ident("bitbucket", "benchmarkme", "archived")] }),
      svc({ id: 2, name: "benchmarkmeapp", identities: [ident("github", "benchmarkmeapp", "active")] }),
    ] }} />);
    // Two "same as…" buttons; the second row sorted is benchmarkmeapp.
    fireEvent.click(screen.getAllByRole("button", { name: "same as…" })[1]);
    fireEvent.change(screen.getByLabelText("Merge benchmarkmeapp into"), { target: { value: "1" } });
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true));
    expect(JSON.parse(calls.find((c) => c.init?.method === "PATCH")!.init!.body as string))
      .toEqual({ kind: "service", action: "merge", provider: "github", key: "benchmarkmeapp", intoId: 1 });
  });

  it("offers a split on a linked entry, which reverses the merge", async () => {
    const calls = okFetch();
    render(<TeamTab roster={{ people: [], services: [svc({
      identities: [ident("bitbucket", "repo-a", "archived"), ident("github", "repo-a", "active")],
    })] }} />);
    fireEvent.click(screen.getByRole("button", { name: /split GitHub/ }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true));
    expect(JSON.parse(calls.find((c) => c.init?.method === "PATCH")!.init!.body as string))
      .toEqual({ kind: "service", action: "split", provider: "github", key: "repo-a" });
  });

  // Failure scenario: a person merged from two Bitbucket accounts shows two buttons both
  // reading "split Bitbucket", so the user cannot tell which account each one detaches
  // and picks at random.
  it("names the account when one person holds two identities on a provider", async () => {
    const calls = okFetch();
    render(<TeamTab roster={{ people: [person({
      identities: [{ provider: "bitbucket", accountId: "bb-named" }, { provider: "bitbucket", accountId: "bb-raw" }],
    })], services: [] }} />);

    expect((screen.getByRole("button", { name: "split bb-named" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "split bb-raw" }));

    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true));
    expect(JSON.parse(calls.find((c) => c.init?.method === "PATCH")!.init!.body as string))
      .toEqual({ kind: "person", action: "split", provider: "bitbucket", key: "bb-raw" });
  });

  it("flags people whose display name equals their login as possible duplicates", () => {
    render(<TeamTab roster={{ services: [], people: [
      person({ id: 1, displayName: "Alice Smith" }),
      person({ id: 2, displayName: "newbie", identities: [{ provider: "github", accountId: "newbie" }] }),
    ] }} />);
    expect(screen.getByText(/Possible duplicates: 1 person/)).toBeTruthy();
    expect(screen.getAllByText("possible duplicate")).toHaveLength(1);
  });

  it("says so when a ticked service's provider has no credentials", () => {
    render(<TeamTab roster={{ people: [], services: [svc()], unconfiguredProviders: ["github"] }} />);
    expect(screen.getByText(/no GitHub credentials are configured \(GITHUB_TOKEN\)/)).toBeTruthy();
  });

  it("tells the user to run it again after a rate-limited run", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(url === "/api/sync"
        ? { totalPrs: 10, repos: [{}], skipped: [], stoppedEarly: { reason: "GitHub rate limit reached." } }
        : { people: [], services: [] }),
    } as Response)));
    render(<TeamTab roster={{ people: [], services: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
    await waitFor(() => expect(screen.getByText(/Stopped early — GitHub rate limit reached\. Everything that finished is saved; run it again to continue\./)).toBeTruthy());
  });
});
