import { describe, it, expect } from "vitest";
import { buildPrScope, isInScope, countsAsActivity } from "@/lib/analytics/scope";
import type { PullRequestRecord, Service } from "@/types";

const service = (over: Partial<Service> = {}): Service => ({
  id: 1, name: "Repo A", included: true,
  identities: [{
    provider: "bitbucket", repoKey: "repo-a", defaultBranch: "main",
    groupKey: null, state: "archived", lastSyncedOn: null,
  }],
  ...over,
});

const pr = (over: Partial<PullRequestRecord> = {}): PullRequestRecord => ({
  provider: "bitbucket", repoKey: "repo-a", number: 1, serviceId: 1, personId: 1,
  title: "PR", state: "MERGED", createdOn: "2026-01-01T00:00:00Z",
  readyForReviewOn: "2026-01-01T00:00:00Z", readyForReviewPrecision: "fallback",
  mergedOn: "2026-01-02T00:00:00Z", mergedOnPrecision: "derived",
  destinationBranch: "main", url: "https://x/1", ...over,
});

describe("scope", () => {
  it("counts merged and open work, never closed", () => {
    expect(countsAsActivity(pr({ state: "MERGED" }))).toBe(true);
    expect(countsAsActivity(pr({ state: "OPEN" }))).toBe(true);
    expect(countsAsActivity(pr({ state: "CLOSED" }))).toBe(false);
  });

  it("excludes a PR from an excluded service", () => {
    const scope = buildPrScope([service({ included: false })]);
    expect(isInScope(pr(), scope)).toBe(false);
  });

  it("excludes a PR not targeting its own identity's default branch", () => {
    const scope = buildPrScope([service()]);
    expect(isInScope(pr({ destinationBranch: "feature" }), scope)).toBe(false);
  });

  // Archived history must still count.
  it("includes a PR from an archived identity", () => {
    const scope = buildPrScope([service()]);
    expect(isInScope(pr(), scope)).toBe(true);
  });

  // The default branch is per identity: Bitbucket may have used master while the
  // GitHub twin uses main. Keying the branch on provider+repoKey rather than on the
  // service is what lets both halves of one service's history stay in scope.
  it("respects a different default branch on each identity of one service", () => {
    const scope = buildPrScope([service({
      identities: [
        { provider: "bitbucket", repoKey: "repo-a", defaultBranch: "master", groupKey: null, state: "archived", lastSyncedOn: null },
        { provider: "github", repoKey: "repo-a", defaultBranch: "main", groupKey: null, state: "active", lastSyncedOn: null },
      ],
    })]);
    expect(isInScope(pr({ provider: "bitbucket", destinationBranch: "master" }), scope)).toBe(true);
    expect(isInScope(pr({ provider: "github", destinationBranch: "main" }), scope)).toBe(true);
    expect(isInScope(pr({ provider: "github", destinationBranch: "master" }), scope)).toBe(false);
  });
});
