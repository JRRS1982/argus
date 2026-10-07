import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "@/lib/db/schema";
import {
  upsertUsers, upsertRepos, setUserIncluded, setRepoIncluded,
  upsertPullRequest, replaceApprovals,
  getUsers, getRepos, getPullRequests, getApprovals,
  getLastSynced, setLastSynced,
} from "@/lib/db/queries";
import { getLastRefreshedByProvider, upsertPersonIdentity, upsertServiceIdentity } from "@/lib/db/canonical";
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

describe("user/repo upserts preserve include flags", () => {
  it("does not reset included on re-upsert", () => {
    const db = freshDb();
    upsertUsers(db, [{ accountId: "u1", displayName: "Alice" }]);
    setUserIncluded(db, "u1", false);
    upsertUsers(db, [{ accountId: "u1", displayName: "Alice Renamed" }]);
    const [u] = getUsers(db);
    expect(u.included).toBe(false);
    expect(u.displayName).toBe("Alice Renamed");
    db.close();
  });
});

describe("discovery defaults", () => {
  it("adds newly discovered users and repos as excluded, so a first run selects nothing", () => {
    const db = freshDb();
    upsertUsers(db, [{ accountId: "u1", displayName: "Alice" }]);
    upsertRepos(db, [{ slug: "repo-a", name: "Repo A", projectKey: null, mainBranch: "main" }]);
    expect(getUsers(db)[0].included).toBe(false);
    expect(getRepos(db)[0].included).toBe(false);
    db.close();
  });

  it("keeps an explicit inclusion when Discover runs again", () => {
    const db = freshDb();
    upsertUsers(db, [{ accountId: "u1", displayName: "Alice" }]);
    setUserIncluded(db, "u1", true);
    upsertUsers(db, [{ accountId: "u1", displayName: "Alice Renamed" }]);
    expect(getUsers(db)[0].included).toBe(true);
    db.close();
  });
});

describe("roster ordering", () => {
  it("returns users alphabetically regardless of case", () => {
    const db = freshDb();
    upsertUsers(db, [
      { accountId: "u1", displayName: "Zoe Adams" },
      { accountId: "u2", displayName: "carolyn.symonds" },
      { accountId: "u3", displayName: "Andrew Shepherd" },
      { accountId: "u4", displayName: "bob.jones" },
    ]);
    expect(getUsers(db).map((u) => u.displayName))
      .toEqual(["Andrew Shepherd", "bob.jones", "carolyn.symonds", "Zoe Adams"]);
    db.close();
  });

  it("returns repos alphabetically regardless of case", () => {
    const db = freshDb();
    upsertRepos(db, [
      { slug: "zeus", name: "zeus", projectKey: null, mainBranch: "main" },
      { slug: "artemis", name: "Artemis", projectKey: null, mainBranch: "main" },
      { slug: "phobos", name: "phobos", projectKey: null, mainBranch: "main" },
      { slug: "deimos", name: "Deimos", projectKey: null, mainBranch: "main" },
    ]);
    expect(getRepos(db).map((r) => r.name)).toEqual(["Artemis", "Deimos", "phobos", "zeus"]);
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
    upsertRepos(db, [
      { slug: "repo-a", name: "A", projectKey: null, mainBranch: "main" },
      { slug: "repo-b", name: "B", projectKey: null, mainBranch: "main" },
      { slug: "repo-c", name: "C", projectKey: null, mainBranch: "main" },
    ]);
    setRepoIncluded(db, "repo-a", true);
    setRepoIncluded(db, "repo-b", true);
    expect(lastRefreshed(db)).toBeNull();

    setLastSynced(db, "bitbucket", "repo-a", "2026-06-01T00:00:00.000Z");
    setLastSynced(db, "bitbucket", "repo-b", "2026-06-02T00:00:00.000Z");
    setLastSynced(db, "bitbucket", "repo-c", "2026-06-09T00:00:00.000Z"); // excluded, must not count
    expect(lastRefreshed(db)).toBe("2026-06-02T00:00:00.000Z");
    db.close();
  });
});
