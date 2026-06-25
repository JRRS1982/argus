import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "@/lib/db/schema";
import { getPullRequests, getApprovals, getLastSynced, setLastSynced } from "@/lib/db/queries";
import { syncRepo, type SyncDeps } from "@/lib/sync/sync";

const freshDb = () => { const db = new Database(":memory:"); applySchema(db); return db; };

const basePr = {
  id: 5, repoSlug: "repo-a", authorAccountId: "u1", title: "T", state: "MERGED" as const,
  createdOn: "2026-01-01T00:00:00.000Z", mergedOn: "2026-01-05T00:00:00.000Z",
  destinationBranch: "main", url: "https://x/5",
};

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
});
