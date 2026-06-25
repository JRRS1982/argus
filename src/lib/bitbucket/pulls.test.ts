import { describe, it, expect, vi } from "vitest";
import {
  deriveReadyForReview, extractApprovals, fetchPullRequestsUpdatedSince, type RawActivity,
} from "@/lib/bitbucket/pulls";

describe("deriveReadyForReview", () => {
  it("uses the draft-removed update timestamp when present", () => {
    const activity: RawActivity[] = [
      { update: { date: "2026-01-03T00:00:00.000Z", draft: false } },
      { approval: { date: "2026-01-04T00:00:00.000Z", user: { account_id: "u2" } } },
    ];
    const r = deriveReadyForReview("2026-01-01T00:00:00.000Z", activity);
    expect(r).toEqual({ readyForReviewOn: "2026-01-03T00:00:00.000Z", readyIsFallback: false });
  });

  it("falls back to createdOn when no draft transition is recorded", () => {
    const activity: RawActivity[] = [
      { approval: { date: "2026-01-04T00:00:00.000Z", user: { account_id: "u2" } } },
    ];
    const r = deriveReadyForReview("2026-01-01T00:00:00.000Z", activity);
    expect(r).toEqual({ readyForReviewOn: "2026-01-01T00:00:00.000Z", readyIsFallback: true });
  });
});

describe("extractApprovals", () => {
  it("returns one record per approval activity entry", () => {
    const activity: RawActivity[] = [
      { approval: { date: "2026-01-04T00:00:00.000Z", user: { account_id: "u2" } } },
      { update: { date: "2026-01-03T00:00:00.000Z" } },
      { approval: { date: "2026-01-05T00:00:00.000Z", user: { account_id: "u3" } } },
    ];
    expect(extractApprovals("repo-a", 1, activity)).toEqual([
      { repoSlug: "repo-a", prId: 1, approverAccountId: "u2", approvedOn: "2026-01-04T00:00:00.000Z" },
      { repoSlug: "repo-a", prId: 1, approverAccountId: "u3", approvedOn: "2026-01-05T00:00:00.000Z" },
    ]);
  });
});

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, statusText: "OK", json: async () => body }) as Response;

describe("fetchPullRequestsUpdatedSince", () => {
  it("maps PR fields and scopes the query by updated_on", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        values: [{
          id: 5, title: "Add thing", state: "MERGED",
          created_on: "2026-01-01T00:00:00.000Z", updated_on: "2026-01-02T00:00:00.000Z",
          author: { account_id: "u1" },
          destination: { branch: { name: "main" } },
          links: { html: { href: "https://x/5" } },
        }],
      }),
    );
    const prs = await fetchPullRequestsUpdatedSince(
      "ws", "repo-a", "2025-12-01T00:00:00.000Z", "auth", fetchFn as unknown as typeof fetch,
    );
    expect(prs[0]).toMatchObject({
      id: 5, repoSlug: "repo-a", authorAccountId: "u1", title: "Add thing",
      state: "MERGED", destinationBranch: "main", url: "https://x/5", mergedOn: "2026-01-02T00:00:00.000Z",
    });
    const url = fetchFn.mock.calls[0][0] as string;
    expect(decodeURIComponent(url)).toContain('updated_on>="2025-12-01T00:00:00.000Z"');
  });
});
