import { describe, it, expect, vi } from "vitest";
import { isRepoLevel } from "@/lib/providers/repo-level";
import {
  deriveReadyForReview, extractApprovals, extractApprovalsFromParticipants,
  fetchPullRequestsUpdatedSince, type RawActivity, type RawParticipant,
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

describe("extractApprovalsFromParticipants", () => {
  it("keeps only approvers, with no timestamp available", () => {
    const participants: RawParticipant[] = [
      { approved: true, user: { account_id: "u2" } },
      { approved: false, user: { account_id: "u3" } },
      { approved: true, user: { account_id: "u4" } },
    ];
    expect(extractApprovalsFromParticipants("repo-a", 1, participants)).toEqual([
      { repoSlug: "repo-a", prId: 1, approverAccountId: "u2", approvedOn: null },
      { repoSlug: "repo-a", prId: 1, approverAccountId: "u4", approvedOn: null },
    ]);
  });

  it("tolerates a missing participants array and malformed entries", () => {
    expect(extractApprovalsFromParticipants("repo-a", 1)).toEqual([]);
    expect(extractApprovalsFromParticipants("repo-a", 1, [{ approved: true }])).toEqual([]);
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

  it("tags only a first-page 404 as repo-level, never a later page's", async () => {
    const later = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ values: [], next: "https://api.bitbucket.org/2.0/page2" }))
      .mockResolvedValueOnce(new Response("", { status: 404 }));
    const e2 = await fetchPullRequestsUpdatedSince("ws", "r", "2025-12-01T00:00:00.000Z", "a", later as unknown as typeof fetch).catch((e) => e);
    expect(isRepoLevel(e2)).toBe(false);
    const first = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    const e1 = await fetchPullRequestsUpdatedSince("ws", "r", "2025-12-01T00:00:00.000Z", "a", first as unknown as typeof fetch).catch((e) => e);
    expect(isRepoLevel(e1)).toBe(true);
  });

  it("requests participants and returns their approvals inline", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        values: [{
          id: 7, title: "Add other thing", state: "MERGED",
          created_on: "2026-01-01T00:00:00.000Z", updated_on: "2026-01-02T00:00:00.000Z",
          author: { account_id: "u1" },
          destination: { branch: { name: "main" } },
          links: { html: { href: "https://x/7" } },
          participants: [
            { approved: true, user: { account_id: "u2" } },
            { approved: false, user: { account_id: "u3" } },
          ],
        }],
      }),
    );
    const prs = await fetchPullRequestsUpdatedSince(
      "ws", "repo-a", "2025-12-01T00:00:00.000Z", "auth", fetchFn as unknown as typeof fetch,
    );
    expect(prs[0].approvals).toEqual([
      { repoSlug: "repo-a", prId: 7, approverAccountId: "u2", approvedOn: null },
    ]);
    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).toContain("values.participants.approved");
    expect(url).toContain("values.participants.user.account_id");
  });
});
