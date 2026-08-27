import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "@/lib/db/schema";
import { getPullRequests, getApprovals, getLastSynced, setLastSynced } from "@/lib/db/queries";
import { syncRepo, syncAll, type SyncDeps } from "@/lib/sync/sync";
import { BitbucketApiError, describeHttpFailure } from "@/lib/bitbucket/client";

const freshDb = () => { const db = new Database(":memory:"); applySchema(db); return db; };

const basePr = {
  id: 5, repoSlug: "repo-a", authorAccountId: "u1", title: "T", state: "MERGED" as const,
  createdOn: "2026-01-01T00:00:00.000Z", mergedOn: "2026-01-05T00:00:00.000Z",
  destinationBranch: "main", url: "https://x/5", approvals: [],
};

const approvalOf = (accountId: string) =>
  ({ repoSlug: "repo-a", prId: 5, approverAccountId: accountId, approvedOn: null });

describe("syncRepo", () => {
  it("persists PRs with derived ready time and their approvals, and advances sync_state", async () => {
    const db = freshDb();
    const deps: SyncDeps = {
      db, workspace: "ws", auth: "auth",
      fetchPRs: vi.fn().mockResolvedValue([basePr]),
      fetchActivity: vi.fn().mockResolvedValue([
        { update: { date: "2026-01-02T00:00:00.000Z", draft: false } },
        { approval: { date: "2026-01-04T00:00:00.000Z", user: { account_id: "u2" } } },
      ]),
    };
    const result = await syncRepo(deps, "repo-a", "2026-06-24T00:00:00.000Z");

    expect(result).toEqual({ repoSlug: "repo-a", prCount: 1 });
    const prs = getPullRequests(db);
    expect(prs[0].readyForReviewOn).toBe("2026-01-02T00:00:00.000Z");
    expect(prs[0].readyIsFallback).toBe(false);
    expect(getApprovals(db).map((a) => a.approverAccountId)).toEqual(["u2"]);
    expect(getLastSynced(db, "repo-a")).toBe("2026-06-24T00:00:00.000Z");
    db.close();
  });

  it("uses the stored last_synced_on as the since cursor, falling back to 6 months when unset", async () => {
    const db = freshDb();
    const fetchPRs = vi.fn().mockResolvedValue([]);
    const deps: SyncDeps = { db, workspace: "ws", auth: "auth", fetchPRs, fetchActivity: vi.fn() };

    await syncRepo(deps, "repo-a", "2026-06-24T00:00:00.000Z");
    expect(fetchPRs.mock.calls[0][2]).toBe("2025-12-24T00:00:00.000Z"); // 6 months before now

    setLastSynced(db, "repo-a", "2026-06-01T00:00:00.000Z");
    await syncRepo(deps, "repo-a", "2026-06-24T00:00:00.000Z");
    expect(fetchPRs.mock.calls[1][2]).toBe("2026-06-01T00:00:00.000Z"); // stored cursor
    db.close();
  });

  it("ignores the stored cursor and reaches back to the epoch when backfilling", async () => {
    const db = freshDb();
    const fetchPRs = vi.fn().mockResolvedValue([]);
    const deps: SyncDeps = { db, workspace: "ws", auth: "auth", fetchPRs, fetchActivity: vi.fn(), backfill: true };

    setLastSynced(db, "repo-a", "2026-06-01T00:00:00.000Z");
    await syncRepo(deps, "repo-a", "2026-06-24T00:00:00.000Z");
    expect(fetchPRs.mock.calls[0][2]).toBe("1970-01-01T00:00:00.000Z");
    db.close();
  });

  it("in fast mode takes approvals from participants without any activity call", async () => {
    const db = freshDb();
    const fetchActivity = vi.fn();
    const deps: SyncDeps = {
      db, workspace: "ws", auth: "auth", mode: "fast",
      fetchPRs: vi.fn().mockResolvedValue([{ ...basePr, approvals: [approvalOf("u2"), approvalOf("u3")] }]),
      fetchActivity,
    };
    const result = await syncRepo(deps, "repo-a", "2026-06-24T00:00:00.000Z");

    expect(result).toEqual({ repoSlug: "repo-a", prCount: 1 });
    expect(fetchActivity).not.toHaveBeenCalled();
    expect(getApprovals(db).map((a) => a.approverAccountId).sort()).toEqual(["u2", "u3"]);
    const prs = getPullRequests(db);
    expect(prs[0].readyForReviewOn).toBe(basePr.createdOn);
    expect(prs[0].readyIsFallback).toBe(true);
    expect(getLastSynced(db, "repo-a")).toBe("2026-06-24T00:00:00.000Z");
    db.close();
  });

  it("does not let a fast sync downgrade a ready time or timestamps from a deep sync", async () => {
    const db = freshDb();
    const deep: SyncDeps = {
      db, workspace: "ws", auth: "auth", mode: "deep",
      fetchPRs: vi.fn().mockResolvedValue([basePr]),
      fetchActivity: vi.fn().mockResolvedValue([
        { update: { date: "2026-01-02T00:00:00.000Z", draft: false } },
        { approval: { date: "2026-01-04T00:00:00.000Z", user: { account_id: "u2" } } },
      ]),
    };
    await syncRepo(deep, "repo-a", "2026-06-24T00:00:00.000Z");

    const fast: SyncDeps = {
      db, workspace: "ws", auth: "auth", mode: "fast",
      fetchPRs: vi.fn().mockResolvedValue([{ ...basePr, approvals: [approvalOf("u2"), approvalOf("u3")] }]),
      fetchActivity: vi.fn(),
    };
    await syncRepo(fast, "repo-a", "2026-06-25T00:00:00.000Z");

    const prs = getPullRequests(db);
    expect(prs[0].readyForReviewOn).toBe("2026-01-02T00:00:00.000Z"); // preserved
    expect(prs[0].readyIsFallback).toBe(false);                        // preserved
    const approvals = getApprovals(db).sort((a, b) => a.approverAccountId.localeCompare(b.approverAccountId));
    expect(approvals.map((a) => a.approverAccountId)).toEqual(["u2", "u3"]); // u3 added
    expect(approvals[0].approvedOn).toBe("2026-01-04T00:00:00.000Z");        // timestamp kept
    db.close();
  });

  it("does not advance the cursor when a per-PR activity fetch fails", async () => {
    const db = freshDb();
    const deps: SyncDeps = {
      db, workspace: "ws", auth: "auth",
      fetchPRs: vi.fn().mockResolvedValue([basePr]),
      fetchActivity: vi.fn().mockRejectedValue(new Error("boom")),
    };
    await expect(syncRepo(deps, "repo-a", "2026-06-24T00:00:00.000Z")).rejects.toThrow("boom");
    expect(getLastSynced(db, "repo-a")).toBeNull();
    db.close();
  });
});

describe("syncAll", () => {
  const okDeps = (): SyncDeps => ({
    db: freshDb(), workspace: "ws", auth: "auth", mode: "fast",
    fetchPRs: vi.fn().mockResolvedValue([basePr]),
    fetchActivity: vi.fn(),
  });

  it("skips a repo that fails and still syncs every repo after it", async () => {
    const deps = okDeps();
    deps.fetchPRs = vi.fn(async (_ws: string, slug: string) => {
      if (slug === "gone") throw new BitbucketApiError(404, "Not Found", "https://x/gone/pullrequests?state=MERGED");
      return [{ ...basePr, repoSlug: slug }];
    }) as SyncDeps["fetchPRs"];

    const result = await syncAll(deps, ["repo-a", "gone", "repo-b"], "2026-06-24T00:00:00.000Z");

    expect(result.repos.map((r) => r.repoSlug)).toEqual(["repo-a", "repo-b"]);
    expect(result.totalPrs).toBe(2);
    expect(result.skipped).toEqual([
      {
        repoSlug: "gone",
        reason: describeHttpFailure(404, "Not Found"),
        status: 404,
        missing: true,
      },
    ]);
    deps.db.close();
  });

  it("marks a transient failure as not missing, so the UI never offers to untick it", async () => {
    const deps = okDeps();
    deps.fetchPRs = vi.fn(async (_ws: string, slug: string) => {
      if (slug === "flaky") throw new BitbucketApiError(503, "Service Unavailable", "https://x");
      if (slug === "odd") throw new Error("socket hang up");
      return [{ ...basePr, repoSlug: slug }];
    }) as SyncDeps["fetchPRs"];

    const { skipped } = await syncAll(deps, ["flaky", "odd"], "2026-06-24T00:00:00.000Z");

    expect(skipped.map((s) => s.missing)).toEqual([false, false]);
    expect(skipped[1]).toEqual({ repoSlug: "odd", reason: "socket hang up", status: null, missing: false });
    deps.db.close();
  });
});
