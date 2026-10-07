import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "@/lib/db/schema";
import { getPullRequests, getApprovals, getLastSynced, setLastSynced } from "@/lib/db/queries";
import { upsertServiceIdentity, setServiceIdentityState } from "@/lib/db/canonical";
import { syncAll, type SyncDeps, type SyncableIdentity } from "@/lib/sync/sync";
import { BitbucketApiError } from "@/lib/bitbucket/client";
import { GitHubApiError } from "@/lib/github/client";
import { createGitHubProvider } from "@/lib/github/adapter";
import { tagRepoLevel } from "@/lib/providers/repo-level";
import type { FetchedPullRequest, PullRequestProvider } from "@/lib/providers/types";
import { EPOCH_ISO } from "@/lib/window";

const NOW = "2026-10-07T00:00:00.000Z";
const freshDb = () => { const db = new Database(":memory:"); applySchema(db); return db; };

// A provider stub satisfying the port, so these tests exercise syncAll rather than any
// adapter. Override one method per test.
const fakeProvider = (over: Partial<PullRequestProvider> = {}): PullRequestProvider => ({
  id: "github", label: "GitHub",
  capabilities: { mergeTimestamps: "exact", readyForReviewTimestamps: "onDemand", approvalTimestamps: "onDemand" },
  listPeople: vi.fn().mockResolvedValue([]),
  listRepositories: vi.fn().mockResolvedValue([]),
  listPullRequests: vi.fn().mockResolvedValue([]),
  ...over,
});

const identity = (over: Partial<SyncableIdentity> = {}): SyncableIdentity => ({
  provider: "github", repoKey: "r", serviceId: 1, defaultBranch: "main", state: "active", ...over,
});

const fetchedPr = (over: { approvals?: FetchedPullRequest["approvals"]; complete?: boolean; repoKey?: string } = {}): FetchedPullRequest => ({
  pullRequest: {
    provider: "github", repoKey: over.repoKey ?? "r", number: 5, title: "T", state: "MERGED",
    createdOn: "2026-01-01T00:00:00.000Z", readyForReviewOn: "2026-01-02T00:00:00.000Z",
    readyForReviewPrecision: "derived", mergedOn: "2026-01-05T00:00:00.000Z", mergedOnPrecision: "exact",
    destinationBranch: "main", url: "https://x/5", authorAccountId: "u1",
  },
  approvals: over.approvals ?? [],
  approvalsAreComplete: over.complete ?? true,
});
const approval = (id: string, repoKey = "r") =>
  ({ provider: "github" as const, repoKey, prNumber: 5, approverAccountId: id, approvedOn: null });

describe("syncAll persistence", () => {
  it("stores PRs and approvals under the identity's provider and advances its cursor", async () => {
    const db = freshDb();
    const provider = fakeProvider({
      listPullRequests: vi.fn().mockResolvedValue([fetchedPr({ approvals: [approval("u2")] })]),
    });
    const result = await syncAll({ db, providers: { github: provider } }, [identity()], NOW);

    expect(result.repos).toEqual([{ provider: "github", repoKey: "r", prCount: 1 }]);
    expect(result.totalPrs).toBe(1);
    expect(result.stoppedEarly).toBeNull();
    expect(getPullRequests(db)[0]).toMatchObject({ provider: "github", repoKey: "r", number: 5 });
    expect(getApprovals(db).map((a) => a.approverAccountId)).toEqual(["u2"]);
    expect(getLastSynced(db, "github", "r")).toBe(NOW);
    db.close();
  });

  it("replaces approvals when the history is complete, so a withdrawn approval disappears", async () => {
    const db = freshDb();
    const list = vi.fn()
      .mockResolvedValueOnce([fetchedPr({ approvals: [approval("u2"), approval("u3")] })])
      .mockResolvedValueOnce([fetchedPr({ approvals: [approval("u2")] })]);
    const deps: SyncDeps = { db, providers: { github: fakeProvider({ listPullRequests: list }) } };
    await syncAll(deps, [identity()], NOW);
    await syncAll(deps, [identity()], NOW);
    expect(getApprovals(db).map((a) => a.approverAccountId)).toEqual(["u2"]);
    db.close();
  });

  it("merges approvals from a summary list, which cannot see withdrawals", async () => {
    const db = freshDb();
    const list = vi.fn()
      .mockResolvedValueOnce([fetchedPr({ approvals: [approval("u2")], complete: true })])
      .mockResolvedValueOnce([fetchedPr({ approvals: [approval("u3")], complete: false })]);
    const deps: SyncDeps = { db, providers: { github: fakeProvider({ listPullRequests: list }) } };
    await syncAll(deps, [identity()], NOW);
    await syncAll(deps, [identity()], NOW);
    expect(getApprovals(db).map((a) => a.approverAccountId).sort()).toEqual(["u2", "u3"]);
    db.close();
  });

  it("does not advance the cursor when the fetch fails", async () => {
    const db = freshDb();
    const provider = fakeProvider({ listPullRequests: vi.fn().mockRejectedValue(new Error("boom")) });
    await syncAll({ db, providers: { github: provider } }, [identity()], NOW);
    expect(getLastSynced(db, "github", "r")).toBeNull();
    db.close();
  });
});

describe("syncAll cursors and detail", () => {
  it("uses the stored cursor, falling back to six months, and the epoch on backfill", async () => {
    const db = freshDb();
    const list = vi.fn().mockResolvedValue([]);
    const providers = { github: fakeProvider({ listPullRequests: list }) };
    upsertServiceIdentity(db, "github", "r", "r", "main", null);

    await syncAll({ db, providers }, [identity()], NOW);
    expect(list.mock.calls[0][1]).toBe("2026-04-07T00:00:00.000Z");

    setLastSynced(db, "github", "r", "2026-10-01T00:00:00.000Z");
    await syncAll({ db, providers }, [identity()], NOW);
    expect(list.mock.calls[1][1]).toBe("2026-10-01T00:00:00.000Z");

    await syncAll({ db, providers, backfill: true }, [identity()], NOW);
    expect(list.mock.calls[2][1]).toBe(EPOCH_ISO);
    db.close();
  });

  // GitHub's PR list carries no reviews, so summary detail would never collect an
  // approval on an incremental run and the Approvals tab would under-count for good.
  it("syncs GitHub at full detail on backfill AND on incremental runs", async () => {
    const db = freshDb();
    const list = vi.fn().mockResolvedValue([]);
    const providers = { github: fakeProvider({ listPullRequests: list }) };
    await syncAll({ db, providers, backfill: true }, [identity()], NOW);
    await syncAll({ db, providers }, [identity()], NOW);
    expect(list.mock.calls.map((c) => c[2])).toEqual(["full", "full"]);
    db.close();
  });

  it("lets a provider whose summary carries approvals use it on incremental runs", async () => {
    const db = freshDb();
    const list = vi.fn().mockResolvedValue([]);
    const providers = { bitbucket: fakeProvider({ id: "bitbucket", listPullRequests: list }) };
    const bb = identity({ provider: "bitbucket" });
    await syncAll({ db, providers }, [bb], NOW);
    await syncAll({ db, providers, backfill: true }, [bb], NOW);
    expect(list.mock.calls.map((c) => c[2])).toEqual(["summary", "full"]);
    db.close();
  });
});

describe("syncAll with archived identities", () => {
  it("never issues a request for an archived identity", async () => {
    const db = freshDb();
    const bitbucket = fakeProvider({ id: "bitbucket" });
    const github = fakeProvider();
    await syncAll({ db, providers: { bitbucket, github } }, [
      identity({ provider: "bitbucket", repoKey: "repo-a", state: "archived" }),
      identity({ repoKey: "repo-a" }),
    ], NOW);
    expect(bitbucket.listPullRequests).not.toHaveBeenCalled();
    expect(github.listPullRequests).toHaveBeenCalledOnce();
    db.close();
  });

  it("leaves an archived identity's cursor untouched", async () => {
    const db = freshDb();
    upsertServiceIdentity(db, "bitbucket", "repo-a", "repo-a", "main", null);
    setServiceIdentityState(db, "bitbucket", "repo-a", "archived");
    setLastSynced(db, "bitbucket", "repo-a", "2026-09-28T13:00:00.000Z");
    await syncAll({ db, providers: {} }, [identity({ provider: "bitbucket", repoKey: "repo-a", state: "archived" })], NOW);
    expect(getLastSynced(db, "bitbucket", "repo-a")).toBe("2026-09-28T13:00:00.000Z");
    db.close();
  });

  it("is not stalled by an archived identity whose provider is unconfigured", async () => {
    const db = freshDb();
    const { skipped } = await syncAll({ db, providers: { github: fakeProvider() } }, [
      identity({ provider: "bitbucket", repoKey: "old", state: "archived" }), identity(),
    ], NOW);
    expect(skipped).toEqual([]);
    db.close();
  });
});

describe("syncAll error handling", () => {
  const failingOn = (keys: Record<string, unknown>) => fakeProvider({
    listPullRequests: vi.fn(async (repo: { repoKey: string }) => {
      if (repo.repoKey in keys) throw keys[repo.repoKey];
      return [fetchedPr({ repoKey: repo.repoKey })];
    }),
  });
  const ids = (...keys: string[]) => keys.map((repoKey, i) => identity({ repoKey, serviceId: i + 1 }));

  it("skips a repo that fails and still syncs every repo after it", async () => {
    const db = freshDb();
    const gone = tagRepoLevel(new GitHubApiError(404, "Not Found", "https://api/gone"));
    const provider = failingOn({ gone });
    const result = await syncAll({ db, providers: { github: provider } }, ids("a", "gone", "b"), NOW);

    expect(result.repos.map((r) => r.repoKey)).toEqual(["a", "b"]);
    expect(result.skipped).toEqual([
      { provider: "github", repoKey: "gone", reason: expect.stringMatching(/no longer exists/), status: 404, missing: true },
    ]);
    expect(result.stoppedEarly).toBeNull();
    db.close();
  });

  it("marks a transient or non-HTTP failure as not missing", async () => {
    const db = freshDb();
    const provider = failingOn({
      flaky: new GitHubApiError(503, "Unavailable", "https://x"), odd: new Error("socket hang up"),
    });
    const { skipped } = await syncAll({ db, providers: { github: provider } }, ids("flaky", "odd"), NOW);
    expect(skipped.map((s) => s.missing)).toEqual([false, false]);
    expect(skipped[1]).toMatchObject({ reason: "socket hang up", status: null });
    db.close();
  });

  it("does not call a repo missing when a 404 comes from somewhere other than its PR list", async () => {
    const db = freshDb();
    // Untagged: this is what a per-PR timeline/reviews 404 or a pagination cursor looks like.
    const provider = failingOn({ r: new GitHubApiError(404, "Not Found", "https://x/pulls/5/reviews") });
    const { skipped } = await syncAll({ db, providers: { github: provider } }, ids("r"), NOW);
    expect(skipped[0]).toMatchObject({ status: 404, missing: false });
    db.close();
  });

  it("keeps going after a 403 or 404, which really are per-repo", async () => {
    const db = freshDb();
    const provider = failingOn({
      a: new GitHubApiError(403, "Forbidden", "https://x"),
      b: tagRepoLevel(new GitHubApiError(404, "Not Found", "https://x")),
    });
    const { repos, skipped } = await syncAll({ db, providers: { github: provider } }, ids("a", "b", "c"), NOW);
    expect(repos.map((r) => r.repoKey)).toEqual(["c"]);
    expect(skipped.map((s) => s.missing)).toEqual([false, true]);
    db.close();
  });

  it("never offers removal for a service that still holds an archived identity", async () => {
    const db = freshDb();
    const provider = failingOn({ r: tagRepoLevel(new GitHubApiError(404, "Not Found", "https://x")) });
    const { skipped } = await syncAll({ db, providers: { github: provider } }, [
      identity({ serviceId: 7 }),
      identity({ provider: "bitbucket", serviceId: 7, state: "archived" }),
    ], NOW);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ status: 404, missing: false });
    db.close();
  });

  it("offers removal when every identity of the service is missing", async () => {
    const db = freshDb();
    const gone = () => tagRepoLevel(new GitHubApiError(404, "Not Found", "https://x"));
    const providers = {
      github: failingOn({ r: gone() }),
      bitbucket: fakeProvider({ id: "bitbucket", listPullRequests: vi.fn().mockRejectedValue(
        tagRepoLevel(new BitbucketApiError(404, "Not Found", "https://x"))) }),
    };
    const { skipped } = await syncAll({ db, providers }, [
      identity({ serviceId: 7 }), identity({ provider: "bitbucket", serviceId: 7 }),
    ], NOW);
    expect(skipped.map((s) => s.missing)).toEqual([true, true]);
    db.close();
  });
});

describe("syncAll run-wide failures", () => {
  const ids = (...keys: string[]) => keys.map((repoKey, i) => identity({ repoKey, serviceId: i + 1 }));
  const failing = (provider: "github" | "bitbucket", status: number, onKey: string) => fakeProvider({
    id: provider,
    listPullRequests: vi.fn(async (repo: { repoKey: string }) => {
      if (repo.repoKey === onKey) {
        throw provider === "github"
          ? new GitHubApiError(status, "x", "https://api.github.com/x")
          : new BitbucketApiError(status, "x", "https://x");
      }
      return [fetchedPr({ repoKey: repo.repoKey })];
    }),
  });

  // The carry-forward that mattered most: toSkipped narrowed on BitbucketApiError, so a
  // GitHub failure came out with status null and the run carried on through a rate limit.
  it("aborts the run on a GitHub 429 and reports the rest as not attempted", async () => {
    const db = freshDb();
    const provider = failing("github", 429, "b");
    const result = await syncAll({ db, providers: { github: provider } }, ids("a", "b", "c", "d"), NOW);

    expect(result.repos.map((r) => r.repoKey)).toEqual(["a"]);
    expect(result.skipped.map((s) => s.repoKey)).toEqual(["b", "c", "d"]);
    expect(result.skipped[0].status).toBe(429);
    expect(result.skipped.slice(1).every((s) => s.status === null && !s.missing)).toBe(true);
    expect(provider.listPullRequests).toHaveBeenCalledTimes(2);
    expect(result.stoppedEarly).toMatchObject({ provider: "github", status: 429 });
    // What finished is kept, and only the repo that finished has a cursor.
    expect(getLastSynced(db, "github", "a")).toBe(NOW);
    expect(getLastSynced(db, "github", "b")).toBeNull();
    expect(getPullRequests(db).map((p) => p.repoKey)).toEqual(["a"]);
    db.close();
  });

  it("aborts the run on a GitHub 401", async () => {
    const db = freshDb();
    const provider = failing("github", 401, "a");
    const result = await syncAll({ db, providers: { github: provider } }, ids("a", "b", "c"), NOW);
    expect(provider.listPullRequests).toHaveBeenCalledTimes(1);
    expect(result.skipped).toHaveLength(3);
    expect(result.stoppedEarly).toMatchObject({ provider: "github", status: 401 });
    db.close();
  });

  it("aborts on a GitHub rate limit that arrives as a real 403 response through the adapter", async () => {
    const db = freshDb();
    const fetchFn = vi.fn(async () => new Response("{}", {
      status: 403, headers: { "x-ratelimit-remaining": "0" },
    })) as unknown as typeof fetch;
    const provider = createGitHubProvider("org", "tok", fetchFn);
    const result = await syncAll({ db, providers: { github: provider } }, ids("a", "b", "c"), NOW);
    expect(result.skipped.map((s) => s.status)).toEqual([429, null, null]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    db.close();
  });

  it("still aborts on a Bitbucket 401", async () => {
    const db = freshDb();
    const provider = failing("bitbucket", 401, "b");
    const bb = (k: string, i: number) => identity({ provider: "bitbucket", repoKey: k, serviceId: i });
    const result = await syncAll({ db, providers: { bitbucket: provider } }, ["a", "b", "c"].map(bb), NOW);
    expect(result.skipped.map((s) => s.repoKey)).toEqual(["b", "c"]);
    db.close();
  });
});
