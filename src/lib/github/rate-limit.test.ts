// src/lib/github/rate-limit.test.ts
// Failure scenario: Argus shares the user's GitHub token, so a backfill that spends the
// whole hourly allowance locks them out of their own `gh` and github.com for the rest of
// the hour. These pin the three limits that stop that happening.
import { describe, it, expect, vi } from "vitest";
import {
  createRateLimitGovernor, RateLimitBudgetError, fetchRateLimit, describeExhausted,
} from "@/lib/github/rate-limit";
import { ProviderApiError } from "@/lib/providers/types";

const BUDGET = { reserve: 1000, maxRequestsPerRun: 3000, minIntervalMs: 0 };

const reply = (headers: Record<string, string> = {}, ok = true) =>
  new Response(ok ? "{}" : "nope", { status: ok ? 200 : 403, headers });

const quota = (remaining: number, reset = 1_800_000_000) => ({
  "x-ratelimit-limit": "5000",
  "x-ratelimit-remaining": String(remaining),
  "x-ratelimit-reset": String(reset),
});

describe("rate limit governor", () => {
  it("stops before spending the requests reserved for the user", async () => {
    const governor = createRateLimitGovernor(BUDGET);
    const fetchFn = governor.wrap(vi.fn(async () => reply(quota(1000))));

    await fetchFn("https://api.github.com/a");

    await expect(fetchFn("https://api.github.com/b")).rejects.toThrow(RateLimitBudgetError);
    expect(governor.status().spent).toBe(1);
  });

  it("keeps going while the reserve is intact", async () => {
    const governor = createRateLimitGovernor(BUDGET);
    const fetchFn = governor.wrap(vi.fn(async () => reply(quota(1001))));

    await fetchFn("https://api.github.com/a");
    await expect(fetchFn("https://api.github.com/b")).resolves.toBeInstanceOf(Response);
  });

  it("stops one run from spending more than its share even on a full quota", async () => {
    const governor = createRateLimitGovernor({ ...BUDGET, maxRequestsPerRun: 2 });
    const fetchFn = governor.wrap(vi.fn(async () => reply(quota(5000))));

    await fetchFn("https://api.github.com/a");
    await fetchFn("https://api.github.com/b");

    await expect(fetchFn("https://api.github.com/c")).rejects.toThrow(/the most one refresh will make/);
  });

  // Sync aborts the whole run on 401 and 429 only. Anything else and it would carry on to
  // the next repo, issuing one more doomed request per repo against a quota it has
  // already decided to protect.
  it("reports its stop as a 429 so the whole run halts", async () => {
    const governor = createRateLimitGovernor({ ...BUDGET, maxRequestsPerRun: 0 });
    const fetchFn = governor.wrap(vi.fn(async () => reply(quota(5000))));

    const err = await fetchFn("https://api.github.com/a").catch((e) => e);
    expect(err).toBeInstanceOf(ProviderApiError);
    expect(err.status).toBe(429);
    expect(err.provider).toBe("github");
  });

  it("names when the allowance returns, so the user knows when to retry", async () => {
    const governor = createRateLimitGovernor(BUDGET);
    // 1_800_000_000 is 2027-01-15T08:00:00Z.
    const fetchFn = governor.wrap(vi.fn(async () => reply(quota(10, 1_800_000_000))));

    await fetchFn("https://api.github.com/a");

    await expect(fetchFn("https://api.github.com/b")).rejects.toThrow(/resets at 08:00 UTC/);
  });

  it("reads the quota from a rejected response too", async () => {
    const governor = createRateLimitGovernor(BUDGET);
    const fetchFn = governor.wrap(vi.fn(async () => reply(quota(0), false)));

    await fetchFn("https://api.github.com/a");

    expect(governor.status().remaining).toBe(0);
    await expect(fetchFn("https://api.github.com/b")).rejects.toThrow(RateLimitBudgetError);
  });

  it("refuses the very first request when seeded below the reserve", async () => {
    const governor = createRateLimitGovernor(BUDGET);
    const inner = vi.fn(async () => reply(quota(5000)));
    const fetchFn = governor.wrap(inner);
    governor.seed({ limit: 5000, remaining: 12, resetAt: "2027-01-15T08:00:00.000Z" });

    await expect(fetchFn("https://api.github.com/a")).rejects.toThrow(RateLimitBudgetError);
    expect(inner).not.toHaveBeenCalled();
  });

  it("paces requests by the configured interval", async () => {
    let clock = 0;
    const slept: number[] = [];
    const governor = createRateLimitGovernor(
      { ...BUDGET, minIntervalMs: 50 },
      () => clock,
      async (ms) => { slept.push(ms); clock += ms; },
    );
    const fetchFn = governor.wrap(vi.fn(async () => reply(quota(5000))));

    await fetchFn("https://api.github.com/a");
    await fetchFn("https://api.github.com/b");
    clock += 50; // enough time has passed on its own
    await fetchFn("https://api.github.com/c");

    expect(slept).toEqual([50]);
  });

  it("leaves the quota unknown rather than guessing when no headers are sent", async () => {
    const governor = createRateLimitGovernor(BUDGET);
    const fetchFn = governor.wrap(vi.fn(async () => reply()));

    await fetchFn("https://api.github.com/a");

    expect(governor.status().remaining).toBeNull();
    await expect(fetchFn("https://api.github.com/b")).resolves.toBeInstanceOf(Response);
  });
});

describe("fetchRateLimit", () => {
  it("reports the core allowance without spending any of it", async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL) => new Response(JSON.stringify({
      resources: { core: { limit: 5000, remaining: 4321, reset: 1_800_000_000 } },
    }), { status: 200 }));

    expect(await fetchRateLimit("tok", fetchFn)).toEqual({
      limit: 5000, remaining: 4321, resetAt: "2027-01-15T08:00:00.000Z",
    });
    expect(fetchFn.mock.calls[0][0]).toBe("https://api.github.com/rate_limit");
  });
});

describe("describeExhausted", () => {
  it("says how much is left, how much is held back, and when to retry", () => {
    expect(describeExhausted({ remaining: 400, resetAt: "2027-01-15T08:00:00.000Z" }, 1000))
      .toMatch(/400 GitHub requests remain.*keeps 1000 free.*resets at 08:00 UTC/);
  });
});
