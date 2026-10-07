import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "@/lib/db/schema";
import {
  upsertBitbucketUsers, upsertBitbucketRepos,
  upsertPullRequest, replaceApprovals,
  getPullRequests, getApprovals,
  getLastSynced, setLastSynced,
} from "@/lib/db/queries";
import { getPeople, getServices, setPersonIncluded, setServiceIncluded, getLastRefreshedByProvider, upsertPersonIdentity, upsertServiceIdentity } from "@/lib/db/canonical";
import type { PullRequestRecord, ApprovalRecord } from "@/types";

const freshDb = () => {
  const db = new Database(":memory:");
  applySchema(db);
  return db;
};

// Foreign keys are on, so a PR can only point at a person and service that exist.
// On a fresh database this yields person 1, repo-a = service 1 and repo-b = service 2.
const seed = (db: Database.Database) => {
  upsertPersonIdentity(db, "bitbucket", "u1", "Alice");
  upsertServiceIdentity(db, "bitbucket", "repo-a", "repo-a", "main", null);
  upsertServiceIdentity(db, "bitbucket", "repo-b", "repo-b", "main", null);
};

const samplePr = (over: Partial<PullRequestRecord> = {}): PullRequestRecord => ({
  provider: "bitbucket", number: 1, repoKey: "repo-a", serviceId: 1, personId: 1, title: "PR", state: "MERGED",
  createdOn: "2026-01-01T00:00:00.000Z", readyForReviewOn: "2026-01-01T00:00:00.000Z",
  readyForReviewPrecision: "fallback", mergedOn: "2026-01-02T00:00:00.000Z",
  mergedOnPrecision: "derived", destinationBranch: "main", url: "https://x/1", ...over,
});

describe("applySchema", () => {
  it("creates all five tables", () => {
    const db = freshDb();
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    // The canonical tables arrive alongside these, so the original five are asserted
    // as still present rather than as the whole schema.
    expect(names).toEqual(expect.arrayContaining(["approvals", "pull_requests", "repos", "sync_state", "users"]));
    db.close();
  });
});

describe("discovery defaults", () => {
  it("adds newly discovered users and repos as excluded, so a first run selects nothing", () => {
    const db = freshDb();
    upsertBitbucketUsers(db, [{ accountId: "u1", displayName: "Alice" }]);
    upsertBitbucketRepos(db, [{ slug: "repo-a", name: "Repo A", projectKey: null, mainBranch: "main" }]);
    expect(getPeople(db)[0].included).toBe(false);
    expect(getServices(db)[0].included).toBe(false);
    db.close();
  });

  it("keeps an explicit inclusion and never resets it when Discover runs again", () => {
    const db = freshDb();
    upsertBitbucketUsers(db, [{ accountId: "u1", displayName: "Alice" }]);
    upsertBitbucketRepos(db, [{ slug: "repo-a", name: "Repo A", projectKey: null, mainBranch: "main" }]);
    setPersonIncluded(db, getPeople(db)[0].id, true);
    setServiceIncluded(db, getServices(db)[0].id, true);
    upsertBitbucketUsers(db, [{ accountId: "u1", displayName: "Alice Renamed" }]);
    upsertBitbucketRepos(db, [{ slug: "repo-a", name: "Repo A2", projectKey: null, mainBranch: "main" }]);
    expect(getPeople(db)).toHaveLength(1);
    expect(getServices(db)).toHaveLength(1);
    expect(getPeople(db)[0]).toMatchObject({ included: true, displayName: "Alice Renamed" });
    expect(getServices(db)[0].included).toBe(true);
    db.close();
  });

  it("does not write the legacy users/repos tables any more", () => {
    const db = freshDb();
    upsertBitbucketUsers(db, [{ accountId: "u1", displayName: "Alice" }]);
    upsertBitbucketRepos(db, [{ slug: "repo-a", name: "Repo A", projectKey: null, mainBranch: "main" }]);
    expect((db.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }).c).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) AS c FROM repos`).get() as { c: number }).c).toBe(0);
    db.close();
  });
});

describe("pull request + approval persistence", () => {
  it("upserts a PR and round-trips it", () => {
    const db = freshDb();
    seed(db);
    upsertPullRequest(db, samplePr());
    upsertPullRequest(db, samplePr({ title: "Updated" })); // same (repo,id) -> update
    const prs = getPullRequests(db);
    expect(prs).toHaveLength(1);
    expect(prs[0].title).toBe("Updated");
    expect(prs[0].mergedOn).toBe("2026-01-02T00:00:00.000Z");
    db.close();
  });

  it("treats same id in different repos as distinct PRs", () => {
    const db = freshDb();
    seed(db);
    upsertPullRequest(db, samplePr({ repoKey: "repo-a", serviceId: 1, number: 7 }));
    upsertPullRequest(db, samplePr({ repoKey: "repo-b", serviceId: 2, number: 7 }));
    expect(getPullRequests(db)).toHaveLength(2);
    db.close();
  });

  it("replaceApprovals overwrites prior approvals for that PR", () => {
    const db = freshDb();
    seed(db);
    const a = (acc: string): ApprovalRecord => ({ provider: "bitbucket", repoKey: "repo-a", prNumber: 1, approverAccountId: acc, personId: 1, approvedOn: null });
    replaceApprovals(db, "bitbucket", "repo-a", 1, [a("u2"), a("u3")]);
    replaceApprovals(db, "bitbucket", "repo-a", 1, [a("u2")]);
    const all = getApprovals(db);
    expect(all.map((x) => x.approverAccountId)).toEqual(["u2"]);
    db.close();
  });
});

// The freshness card shows the first provider's stamp, so that is what this reads.
const lastRefreshed = (db: Database.Database): string | null =>
  getLastRefreshedByProvider(db)[0]?.lastSyncedOn ?? null;

describe("sync_state", () => {
  it("returns null before set, then the stored value", () => {
    const db = freshDb();
    seed(db); // the cursor lives on the service identity, which must exist first
    expect(getLastSynced(db, "bitbucket", "repo-a")).toBeNull();
    setLastSynced(db, "bitbucket", "repo-a", "2026-06-01T00:00:00.000Z");
    setLastSynced(db, "bitbucket", "repo-a", "2026-06-02T00:00:00.000Z");
    expect(getLastSynced(db, "bitbucket", "repo-a")).toBe("2026-06-02T00:00:00.000Z");
    db.close();
  });

  it("reports the newest sync stamp among included repos, or null before any sync", () => {
    const db = freshDb();
    upsertBitbucketRepos(db, [
      { slug: "repo-a", name: "A", projectKey: null, mainBranch: "main" },
      { slug: "repo-b", name: "B", projectKey: null, mainBranch: "main" },
      { slug: "repo-c", name: "C", projectKey: null, mainBranch: "main" },
    ]);
    getServices(db).filter((s) => s.name !== "C").forEach((s) => setServiceIncluded(db, s.id, true));
    expect(lastRefreshed(db)).toBeNull();

    setLastSynced(db, "bitbucket", "repo-a", "2026-06-01T00:00:00.000Z");
    setLastSynced(db, "bitbucket", "repo-b", "2026-06-02T00:00:00.000Z");
    setLastSynced(db, "bitbucket", "repo-c", "2026-06-09T00:00:00.000Z"); // excluded, must not count
    expect(lastRefreshed(db)).toBe("2026-06-02T00:00:00.000Z");
    db.close();
  });
});