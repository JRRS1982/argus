import { describe, it, expect } from "vitest";
import { createBitbucketProvider } from "@/lib/bitbucket/adapter";
import { BitbucketApiError } from "@/lib/bitbucket/client";
import { ProviderApiError } from "@/lib/providers/types";

const pr = (state: string) => ({
  id: 7, title: "t", state, created_on: "2026-01-01T00:00:00Z", updated_on: "2026-01-03T00:00:00Z",
  author: { account_id: "a1" }, destination: { branch: { name: "main" } },
  links: { html: { href: "https://x/7" } },
  participants: [{ approved: true, user: { account_id: "r1" } }],
});
const activity = { values: [
  { update: { date: "2026-01-02T00:00:00Z", draft: false } },
  { approval: { date: "2026-01-02T12:00:00Z", user: { account_id: "r1" } } },
] };
const fakeFetch = ((url: string) => {
  const body = url.includes("/activity") ? activity : { values: [pr("DECLINED")] };
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}) as unknown as typeof fetch;
const provider = createBitbucketProvider({ workspace: "w", projectKey: null, auth: "x", fetchFn: fakeFetch });
const repo = { repoKey: "r", defaultBranch: "main" };

describe("bitbucket adapter", () => {
  it("summary detail: maps DECLINED to CLOSED, falls back on ready time, approvals are merge-only", async () => {
    const [f] = await provider.listPullRequests(repo, "2026-01-01T00:00:00Z", "summary");
    expect(f.pullRequest.state).toBe("CLOSED");
    expect(f.pullRequest.readyForReviewPrecision).toBe("fallback");
    expect(f.approvalsAreComplete).toBe(false);
    expect(f.approvals).toEqual([expect.objectContaining({ approverAccountId: "r1", approvedOn: null, prNumber: 7 })]);
  });

  it("full detail: derives ready time from activity and approvals are authoritative", async () => {
    const [f] = await provider.listPullRequests(repo, "2026-01-01T00:00:00Z", "full");
    expect(f.pullRequest.readyForReviewOn).toBe("2026-01-02T00:00:00Z");
    expect(f.pullRequest.readyForReviewPrecision).toBe("derived");
    expect(f.approvalsAreComplete).toBe(true);
    expect(f.approvals[0].approvedOn).toBe("2026-01-02T12:00:00Z");
  });

  it("BitbucketApiError is still a ProviderApiError", () => {
    const err = new BitbucketApiError(401, "Unauthorized", "u");
    expect(err).toBeInstanceOf(ProviderApiError);
    expect(err.provider).toBe("bitbucket");
  });
});
