import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "@/lib/db/schema";
import {
  upsertUsers, upsertRepos, setUserIncluded, setRepoIncluded,
  upsertPullRequest, replaceApprovals,
  getUsers, getRepos, getPullRequests, getApprovals,
  getLastSynced, setLastSynced,
} from "@/lib/db/queries";
import type { PullRequestRecord, ApprovalRecord } from "@/types";

const freshDb = () => {
  const db = new Database(":memory:");
  applySchema(db);
  return db;
};

const samplePr = (over: Partial<PullRequestRecord> = {}): PullRequestRecord => ({
  id: 1, repoSlug: "repo-a", authorAccountId: "u1", title: "PR", state: "MERGED",
  createdOn: "2026-01-01T00:00:00.000Z", readyForReviewOn: "2026-01-01T00:00:00.000Z",
  readyIsFallback: true, mergedOn: "2026-01-02T00:00:00.000Z",
  destinationBranch: "main", url: "https://x/1", ...over,
});

describe("applySchema", () => {
  it("creates all five tables", () => {
    const db = freshDb();
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toEqual(["approvals", "pull_requests", "repos", "sync_state", "users"]);
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

describe("pull request + approval persistence", () => {
  it("upserts a PR and round-trips it", () => {
    const db = freshDb();
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
    upsertPullRequest(db, samplePr({ repoSlug: "repo-a", id: 7 }));
    upsertPullRequest(db, samplePr({ repoSlug: "repo-b", id: 7 }));
    expect(getPullRequests(db)).toHaveLength(2);
    db.close();
  });

  it("replaceApprovals overwrites prior approvals for that PR", () => {
    const db = freshDb();
    const a = (acc: string): ApprovalRecord => ({ repoSlug: "repo-a", prId: 1, approverAccountId: acc, approvedOn: null });
    replaceApprovals(db, "repo-a", 1, [a("u2"), a("u3")]);
    replaceApprovals(db, "repo-a", 1, [a("u2")]);
    const all = getApprovals(db);
    expect(all.map((x) => x.approverAccountId)).toEqual(["u2"]);
    db.close();
  });
});

describe("sync_state", () => {
  it("returns null before set, then the stored value", () => {
    const db = freshDb();
    expect(getLastSynced(db, "repo-a")).toBeNull();
    setLastSynced(db, "repo-a", "2026-06-01T00:00:00.000Z");
    setLastSynced(db, "repo-a", "2026-06-02T00:00:00.000Z");
    expect(getLastSynced(db, "repo-a")).toBe("2026-06-02T00:00:00.000Z");
    db.close();
  });
});
