// src/lib/providers/contract.ts
import { describe, it, expect } from "vitest";
import type { DetailLevel, PullRequestProvider } from "./types";

// Every adapter must satisfy this. It is what makes adding a provider safe: a new
// adapter is correct when this passes, without reading any other adapter.
//
// The factory must return a provider that has at least one repository, and a repository
// holding at least one MERGED and one non-merged PR. Without that the per-PR assertions
// below loop over nothing and pass vacuously, which would prove nothing.
const SINCE_FOREVER = "1970-01-01T00:00:00.000Z";

const firstRepoPrs = async (p: PullRequestProvider, detail: DetailLevel) => {
  const repos = await p.listRepositories();
  expect(repos.length, "contract needs a provider with at least one repository").toBeGreaterThan(0);
  return p.listPullRequests(
    { repoKey: repos[0].repoKey, defaultBranch: repos[0].defaultBranch }, SINCE_FOREVER, detail,
  );
};

export const describeProviderContract = (
  name: string,
  factory: () => PullRequestProvider,
): void => {
  describe(`${name} provider contract`, () => {
    it("declares an id, a label and capabilities", () => {
      const p = factory();
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(["exact", "derived"]).toContain(p.capabilities.mergeTimestamps);
    });

    it("lists people with a non-empty account id and display name", async () => {
      const people = await factory().listPeople();
      for (const person of people) {
        expect(person.accountId).toBeTruthy();
        expect(person.displayName).toBeTruthy();
      }
    });

    it("lists repositories with a default branch", async () => {
      const repos = await factory().listRepositories();
      for (const repo of repos) {
        expect(repo.repoKey).toBeTruthy();
        expect(repo.defaultBranch).toBeTruthy();
      }
    });

    it("returns only normalised PR states", async () => {
      const fetched = await firstRepoPrs(factory(), "summary");
      expect(fetched.length).toBeGreaterThan(0);
      for (const f of fetched) {
        expect(["OPEN", "MERGED", "CLOSED"]).toContain(f.pullRequest.state);
      }
    });

    it("emits every normalised state, so a closed-unmerged PR is not mistaken for a merged one", async () => {
      const states = new Set((await firstRepoPrs(factory(), "summary")).map((f) => f.pullRequest.state));
      expect([...states].sort()).toEqual(["CLOSED", "MERGED", "OPEN"]);
    });

    it("honours updatedSince: a later cursor returns strictly fewer PRs", async () => {
      const p = factory();
      const repos = await p.listRepositories();
      const ref = { repoKey: repos[0].repoKey, defaultBranch: repos[0].defaultBranch };
      const all = await p.listPullRequests(ref, SINCE_FOREVER, "summary");
      // A PR cannot have been updated before it was created or merged, so the earliest of
      // those "last known" instants is a moment that PR is certain to predate. Derived from
      // the data rather than hard-coded so it suits any provider's dates.
      const lastKnown = all.map((f) =>
        Math.max(Date.parse(f.pullRequest.createdOn), Date.parse(f.pullRequest.mergedOn ?? f.pullRequest.createdOn)));
      const cursor = new Date(Math.min(...lastKnown) + 1).toISOString();
      const later = await p.listPullRequests(ref, cursor, "summary");
      expect(later.length).toBeLessThan(all.length);
    });

    it("stamps its own id on every PR it returns", async () => {
      const p = factory();
      const fetched = await firstRepoPrs(p, "full");
      expect(fetched.length).toBeGreaterThan(0);
      for (const f of fetched) expect(f.pullRequest.provider).toBe(p.id);
    });

    it("marks a merged PR's precision consistently with its declared capability", async () => {
      const p = factory();
      const merged = (await firstRepoPrs(p, "full")).filter((x) => x.pullRequest.state === "MERGED");
      expect(merged.length).toBeGreaterThan(0);
      for (const f of merged) {
        expect(f.pullRequest.mergedOn).toBeTruthy();
        expect(f.pullRequest.mergedOnPrecision).toBe(p.capabilities.mergeTimestamps);
      }
    });

    it("gives an unmerged PR no merge time and no merge precision", async () => {
      const unmerged = (await firstRepoPrs(factory(), "full")).filter((x) => x.pullRequest.state !== "MERGED");
      expect(unmerged.length).toBeGreaterThan(0);
      for (const f of unmerged) {
        expect(f.pullRequest.mergedOn).toBeNull();
        expect(f.pullRequest.mergedOnPrecision).toBeNull();
      }
    });

    it("reports full detail as complete approvals and summary detail as partial", async () => {
      const p = factory();
      const summary = await firstRepoPrs(p, "summary");
      const full = await firstRepoPrs(p, "full");
      expect(summary.length).toBeGreaterThan(0);
      expect(full.length).toBeGreaterThan(0);
      for (const f of summary) expect(f.approvalsAreComplete).toBe(false);
      for (const f of full) expect(f.approvalsAreComplete).toBe(true);
    });

    it("attributes each approval to the PR it came from, with an approver id", async () => {
      const p = factory();
      const fetched = await firstRepoPrs(p, "full");
      for (const f of fetched) {
        for (const a of f.approvals) {
          expect(a.provider).toBe(p.id);
          expect(a.repoKey).toBe(f.pullRequest.repoKey);
          expect(a.prNumber).toBe(f.pullRequest.number);
          expect(a.approverAccountId).toBeTruthy();
        }
      }
    });
  });
};
