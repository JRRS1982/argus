// Drives the real POST /api/sync against an in-memory database. Failure scenario: if this
// is wrong, a refresh spends the whole GitHub hourly allowance and the user cannot use
// `gh` or github.com themselves until it resets — or it reports a protective pause as a
// failure and the user re-runs it into the same wall.
import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { applySchema } from "@/lib/db/schema";
import { upsertServiceIdentity, setServiceIncluded } from "@/lib/db/canonical";

const h = vi.hoisted(() => ({
  db: null as unknown as import("better-sqlite3").Database,
  cfg: {
    workspace: "ws", projectKey: null, dbPath: ":memory:",
    githubToken: "tok" as string | null, githubOrg: "org",
    githubReserve: 1000, githubMaxRequestsPerRun: 3000, githubMinRequestIntervalMs: 0,
  },
  remaining: 5000,
  listed: 0,
}));

vi.mock("@/lib/db", () => ({ getDb: () => h.db }));
vi.mock("@/config", () => ({ config: h.cfg, hasBitbucketCredentials: () => false }));
vi.mock("@/lib/github/rate-limit", async (orig) => ({
  ...(await orig<typeof import("@/lib/github/rate-limit")>()),
  // The real /rate_limit call is the one boundary this test mocks: everything else,
  // including the budget arithmetic, is the real implementation.
  fetchRateLimit: async () => ({
    limit: 5000, remaining: h.remaining, resetAt: "2027-01-15T08:00:00.000Z",
  }),
}));
vi.mock("@/lib/providers/configured", () => ({
  createConfiguredRegistry: () => ({
    all: () => [{
      id: "github", label: "GitHub",
      capabilities: { mergeTimestamps: "exact", readyForReviewTimestamps: "onDemand", approvalTimestamps: "onDemand" },
      listRepositories: async () => [],
      listPeople: async () => [],
      listPullRequests: async () => { h.listed += 1; return []; },
    }],
  }),
}));

import { POST } from "@/app/api/sync/route";

const post = (body: unknown = {}) => POST(new NextRequest("http://localhost/api/sync", {
  method: "POST", body: JSON.stringify(body),
}));

beforeEach(() => {
  h.db = new Database(":memory:");
  applySchema(h.db);
  h.remaining = 5000;
  h.listed = 0;
  h.cfg.githubToken = "tok";
  const id = upsertServiceIdentity(h.db, "github", "repo-a", "Repo A", "main", null);
  setServiceIncluded(h.db, id, true);
});

describe("POST /api/sync rate-limit protection", () => {
  it("refuses to start when the quota is already down to the reserve", async () => {
    h.remaining = 1000;

    const res = await post();

    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/1000 GitHub requests remain.*resets at 08:00 UTC/);
    expect(h.listed).toBe(0);
  });

  it("runs when the quota is above the reserve", async () => {
    h.remaining = 1001;

    const res = await post();

    expect(res.status).toBe(200);
    expect(h.listed).toBe(1);
  });

  it("reports what the quota looked like, so the user can see what is left", async () => {
    h.remaining = 4200;

    const body = await (await post()).json();

    expect(body.rateLimit).toEqual({
      limit: 5000, remaining: 4200, resetAt: "2027-01-15T08:00:00.000Z", spent: 0,
    });
  });
});
