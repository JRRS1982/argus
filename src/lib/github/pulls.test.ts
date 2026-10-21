import { describe, it, expect, vi } from "vitest";
import { describeProviderContract } from "@/lib/providers/contract";
import { createGitHubProvider } from "@/lib/github/adapter";
import { ProviderApiError } from "@/lib/providers/types";
import { isRepoLevel } from "@/lib/providers/repo-level";
import { mapPullRequest, extractApprovals, deriveReadyForReview, fetchPullRequests } from "@/lib/github/pulls";

const rawPr = (over: Record<string, unknown> = {}) => ({
  number: 42, title: "Add thing", state: "closed", draft: false,
  created_at: "2026-07-01T10:00:00Z", merged_at: "2026-07-02T12:00:00Z",
  user: { login: "alice" }, base: { ref: "main" },
  html_url: "https://github.com/mvfglobal/repo-a/pull/42", ...over,
});

describe("mapPullRequest", () => {
  it("marks a merged PR MERGED with an exact merge timestamp", () => {
    const pr = mapPullRequest("repo-a", rawPr());
    expect(pr.state).toBe("MERGED");
    expect(pr.mergedOn).toBe("2026-07-02T12:00:00Z");
    expect(pr.mergedOnPrecision).toBe("exact");
    expect(pr.provider).toBe("github");
    expect(pr.number).toBe(42);
  });

  it("maps a closed-but-unmerged PR to CLOSED with no merge timestamp", () => {
    const pr = mapPullRequest("repo-a", rawPr({ merged_at: null }));
    expect(pr.state).toBe("CLOSED");
    expect(pr.mergedOn).toBeNull();
    expect(pr.mergedOnPrecision).toBeNull();
  });

  it("maps an open PR to OPEN", () => {
    const pr = mapPullRequest("repo-a", rawPr({ state: "open", merged_at: null }));
    expect(pr.state).toBe("OPEN");
  });

  it("falls back to creation time for ready-for-review in summary detail", () => {
    const pr = mapPullRequest("repo-a", rawPr());
    expect(pr.readyForReviewOn).toBe("2026-07-01T10:00:00Z");
    expect(pr.readyForReviewPrecision).toBe("fallback");
  });
});

describe("mapPullRequest authorship", () => {
  it("maps a deleted author (user: null) to GitHub's own 'ghost' sentinel, never an empty id", () => {
    const a = mapPullRequest("repo-a", rawPr({ user: null }));
    const b = mapPullRequest("repo-a", rawPr({ number: 43, user: null }));
    expect(a.authorAccountId).toBe("ghost");
    expect(b.authorAccountId).toBe(a.authorAccountId);
  });
});

describe("deriveReadyForReview", () => {
  it("uses the earliest ready_for_review event when one exists", () => {
    const events = [
      { event: "ready_for_review", created_at: "2026-07-01T15:00:00Z" },
      { event: "ready_for_review", created_at: "2026-07-01T12:00:00Z" },
      { event: "labeled", created_at: "2026-07-01T11:00:00Z" },
    ];
    expect(deriveReadyForReview("2026-07-01T10:00:00Z", events))
      .toEqual({ readyForReviewOn: "2026-07-01T12:00:00Z", readyForReviewPrecision: "exact" });
  });

  it("falls back to creation time when the PR was never a draft", () => {
    expect(deriveReadyForReview("2026-07-01T10:00:00Z", [{ event: "labeled", created_at: "x" }]))
      .toEqual({ readyForReviewOn: "2026-07-01T10:00:00Z", readyForReviewPrecision: "fallback" });
  });
});

describe("extractApprovals", () => {
  it("keeps only APPROVED reviews, with their exact timestamps", () => {
    const reviews = [
      { user: { login: "bob" }, state: "APPROVED", submitted_at: "2026-07-02T09:00:00Z" },
      { user: { login: "carol" }, state: "COMMENTED", submitted_at: "2026-07-02T09:30:00Z" },
      { user: { login: "dave" }, state: "CHANGES_REQUESTED", submitted_at: "2026-07-02T10:00:00Z" },
    ];
    expect(extractApprovals("repo-a", 42, reviews)).toEqual([
      { provider: "github", repoKey: "repo-a", prNumber: 42, approverAccountId: "bob", approvedOn: "2026-07-02T09:00:00Z" },
    ]);
  });

  it("records one approval per approver when someone approves twice", () => {
    const reviews = [
      { user: { login: "bob" }, state: "APPROVED", submitted_at: "2026-07-02T09:00:00Z" },
      { user: { login: "bob" }, state: "APPROVED", submitted_at: "2026-07-03T09:00:00Z" },
    ];
    const approvals = extractApprovals("repo-a", 42, reviews);
    expect(approvals).toHaveLength(1);
    // The primary key is (provider, repo_key, pr_number, approver) — a second row would
    // be rejected on insert, so the duplicate must be collapsed here. Keeping the
    // earliest is consistent with Bitbucket, which records the first approval.
    expect(approvals[0].approvedOn).toBe("2026-07-02T09:00:00Z");
  });
});

const res = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

describe("fetchPullRequests paging", () => {
  const prs = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({
    ...rawPr({ number: from + i }), updated_at: `2026-07-${String(31 - (from + i)).padStart(2, "0")}T00:00:00Z`,
  }));
  it("stops paging once a page reaches PRs older than the cursor", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(res(prs(1, 3), { headers: { Link: '<https://api.github.com/p2>; rel="next"' } }))
      .mockResolvedValueOnce(res(prs(4, 6), { headers: { Link: '<https://api.github.com/p3>; rel="next"' } }));
    // updated days: p1 = 30,29,28; p2 = 27,26,25. Cursor 07-26 is passed on page 2, so page 3 is never fetched
    const out = await fetchPullRequests("o", "r", "2026-07-26T00:00:00Z", "t", fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(out.map((p) => p.number)).toEqual([1, 2, 3, 4, 5]);
  });

  it("tags a failure of the PR list as repo-level", async () => {
    const notFound = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    const err = await fetchPullRequests("o", "r", "1970-01-01T00:00:00Z", "t", notFound).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderApiError);
    expect(isRepoLevel(err)).toBe(true);

  });

  it("tags only a first-page 404: a 404 on page 2 is a cursor failure, not a missing repo", async () => {
    const page2 = vi.fn()
      .mockResolvedValueOnce(res(prs(1, 3), { headers: { Link: '<https://api.github.com/p2>; rel="next"' } }))
      .mockResolvedValueOnce(new Response("", { status: 404 }));
    const later = await fetchPullRequests("o", "r", "1970-01-01T00:00:00Z", "t", page2).catch((e) => e);
    expect(later).toBeInstanceOf(ProviderApiError);
    expect(isRepoLevel(later)).toBe(false);

    const page1 = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    const first = await fetchPullRequests("o", "r", "1970-01-01T00:00:00Z", "t", page1).catch((e) => e);
    expect(isRepoLevel(first)).toBe(true);
  });

  it("does not tag a 404 from one PR's reviews", async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url.includes("/pulls?") ? res([{ ...rawPr(), updated_at: "2026-07-02T12:00:00Z" }]) : new Response("", { status: 404 }));
    const err = await createGitHubProvider("o", "t", fetchFn as never).listPullRequests(
      { repoKey: "r", defaultBranch: "main" }, "1970-01-01T00:00:00Z", "full",
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderApiError);
    expect(isRepoLevel(err)).toBe(false);
  });
});

// Offline GitHub. Earliest-ending PR (#1) has updated_at == max(created, merged), so the
// contract's derived updatedSince cursor excludes it; the closed-unmerged PR (#3) gives all three states.
const gh = (number: number, state: string, created: string, merged: string | null, updated: string) => ({
  number, title: "t", state, draft: false, created_at: created, merged_at: merged, updated_at: updated,
  user: { login: "alice" }, base: { ref: "main" }, html_url: `https://github.com/o/r/pull/${number}`,
});
const fixtureFetch = vi.fn(async (url: string) => {
  if (url.includes("/graphql")) {
    return res({ data: { organization: { membersWithRole: {
      nodes: [{ login: "alice", name: "Alice" }], pageInfo: { hasNextPage: false, endCursor: null } } } } });
  }
  if (url.includes("/reviews")) return res([{ user: { login: "bob" }, state: "APPROVED", submitted_at: "2026-01-02T12:00:00Z" }]);
  if (url.includes("/timeline")) return res([{ event: "ready_for_review", created_at: "2026-01-01T06:00:00Z" }]);
  if (url.includes("/pulls?")) {
    return res([
      gh(3, "closed", "2026-01-10T00:00:00Z", null, "2026-01-11T00:00:00Z"),
      gh(2, "open", "2026-01-05T00:00:00Z", null, "2026-01-06T00:00:00Z"),
      gh(1, "closed", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", "2026-01-02T00:00:00Z"),
    ]);
  }
  return res([{ name: "r", default_branch: "main" }]);
}) as unknown as typeof fetch;

describeProviderContract("github", () => createGitHubProvider("o", "tok", fixtureFetch));
