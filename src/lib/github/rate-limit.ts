// src/lib/github/rate-limit.ts
// Keeps a refresh from spending the whole GitHub quota. The token Argus uses is the same
// one the user works with, so a backfill that drains it to zero blocks their own `gh` and
// web usage for the rest of the hour. Three limits, smallest effect first:
//
//   reserve           — requests never touched, always left for the user
//   maxRequestsPerRun — most any one refresh may spend, however much quota is free
//   minIntervalMs     — smallest gap between requests, to stay clear of secondary limits
//
// Hitting any of them stops the run the same way GitHub's own 429 does, so what was
// fetched is kept and running again carries on.
import { ProviderApiError } from "@/lib/providers/types";
import { GITHUB_API, githubGet, type FetchFn } from "./client";

export type RateLimitBudget = {
  reserve: number;
  maxRequestsPerRun: number;
  minIntervalMs: number;
};

export type RateLimitStatus = {
  limit: number | null;      // the token's hourly allowance, once a response has reported it
  remaining: number | null;  // what is left of it
  resetAt: string | null;    // ISO; when the allowance refills
  spent: number;             // requests this run has made
};

// Reported as 429 so sync's existing run-wide abort applies unchanged: the run stops
// rather than issuing one more rejected request per repo, every completed repo keeps its
// advanced cursor, and the route answers 200 with `stoppedEarly` — a deliberate pause is
// not a failure.
export class RateLimitBudgetError extends ProviderApiError {
  constructor(message: string, url: string) {
    super("github", "GitHub", ["GITHUB_TOKEN"], 429, "Rate limit budget", url);
    this.name = "RateLimitBudgetError";
    this.message = message;
  }
}

// "14:05 UTC". Deliberately not localised: this string is built on the server and read
// in the browser, so a server locale would be the wrong one to format it in.
const atUtc = (iso: string | null): string =>
  iso ? `${iso.slice(11, 16)} UTC` : "an unknown time";

const toIso = (epochSeconds: string | null): string | null => {
  if (!epochSeconds) return null;
  const seconds = Number(epochSeconds);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
};

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

export type RateLimitGovernor = {
  // Decorates a fetch so every GitHub call through it is counted, paced and checked.
  wrap: (fetchFn: FetchFn) => FetchFn;
  // Starting position from a free /rate_limit call, so the first budget check is informed
  // rather than waiting for the first response to report a figure.
  seed: (status: Pick<RateLimitStatus, "limit" | "remaining" | "resetAt">) => void;
  status: () => RateLimitStatus;
};

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const createRateLimitGovernor = (
  budget: RateLimitBudget,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = sleepFor,
): RateLimitGovernor => {
  let limit: number | null = null;
  let remaining: number | null = null;
  let resetAt: string | null = null;
  let spent = 0;
  // Negative infinity, not 0: the first request of a run has nothing to be paced against.
  let lastRequestAt = Number.NEGATIVE_INFINITY;

  return {
    seed: (s) => { limit = s.limit; remaining = s.remaining; resetAt = s.resetAt; },
    status: () => ({ limit, remaining, resetAt, spent }),
    wrap: (fetchFn) => async (input, init) => {
      const url = urlOf(input);
      if (spent >= budget.maxRequestsPerRun) {
        throw new RateLimitBudgetError(
          `Paused after ${spent} GitHub requests, the most one refresh will make.`,
          url,
        );
      }
      if (remaining !== null && remaining <= budget.reserve) {
        throw new RateLimitBudgetError(
          `Paused to leave your GitHub quota usable: ${remaining} requests remain and Argus ` +
          `keeps ${budget.reserve} free for your own use. The allowance resets at ${atUtc(resetAt)}.`,
          url,
        );
      }
      const wait = budget.minIntervalMs - (now() - lastRequestAt);
      if (wait > 0) await sleep(wait);

      lastRequestAt = now();
      spent += 1;
      const res = await fetchFn(input, init);

      // Read from every response, including failures: a 403 carrying
      // x-ratelimit-remaining: 0 is exactly when the figure matters most.
      const reported = res.headers.get("x-ratelimit-remaining");
      if (reported !== null && Number.isFinite(Number(reported))) {
        remaining = Number(reported);
        const reportedLimit = Number(res.headers.get("x-ratelimit-limit"));
        if (Number.isFinite(reportedLimit)) limit = reportedLimit;
        resetAt = toIso(res.headers.get("x-ratelimit-reset")) ?? resetAt;
      }
      return res;
    },
  };
};

type RateLimitResponse = {
  resources: { core: { limit: number; remaining: number; reset: number } };
};

// GitHub does not charge for /rate_limit, so asking before a run costs nothing and tells
// the user where they stand before any work begins.
export const fetchRateLimit = async (
  token: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<Pick<RateLimitStatus, "limit" | "remaining" | "resetAt">> => {
  const body = await githubGet<RateLimitResponse>(`${GITHUB_API}/rate_limit`, token, fetchFn);
  const core = body.resources.core;
  return {
    limit: core.limit,
    remaining: core.remaining,
    resetAt: new Date(core.reset * 1000).toISOString(),
  };
};

// Phrases the refusal to start, when a run would be nothing but rejected requests.
export const describeExhausted = (
  status: Pick<RateLimitStatus, "remaining" | "resetAt">, reserve: number,
): string =>
  `Not refreshing: ${status.remaining} GitHub requests remain and Argus keeps ${reserve} ` +
  `free for your own use. The allowance resets at ${atUtc(status.resetAt)} — try again after that.`;
