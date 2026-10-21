import type { FetchedPullRequest, PullRequestProvider } from "@/lib/providers/types";
import type { FetchFn } from "./client";
import { fetchOrgMembers, fetchOrgRepos } from "./discover";
import {
  deriveReadyForReview, extractApprovals, fetchPullRequests, fetchReadyForReview,
  fetchReviews, mapPullRequest,
} from "./pulls";

export const createGitHubProvider = (
  org: string, token: string, fetchFn: FetchFn = globalThis.fetch,
): PullRequestProvider => ({
  id: "github",
  label: "GitHub",
  // onDemand: ready times and reviews each cost one request per PR.
  capabilities: { mergeTimestamps: "exact", readyForReviewTimestamps: "onDemand", approvalTimestamps: "onDemand" },

  listPeople: () => fetchOrgMembers(org, token, fetchFn),
  listRepositories: () => fetchOrgRepos(org, token, fetchFn),

  listPullRequests: async (repo, updatedSince, detail) => {
    const raws = await fetchPullRequests(org, repo.repoKey, updatedSince, token, fetchFn);
    const out: FetchedPullRequest[] = [];
    for (const raw of raws) {
      const mapped = mapPullRequest(repo.repoKey, raw);
      if (detail === "summary") {
        out.push({ pullRequest: mapped, approvals: [], approvalsAreComplete: false });
        continue;
      }
      // Per-PR calls are deliberately NOT repo-tagged: a 404 here is one PR, not the repo.
      const [reviews, events] = await Promise.all([
        fetchReviews(org, repo.repoKey, raw.number, token, fetchFn),
        fetchReadyForReview(org, repo.repoKey, raw.number, token, fetchFn),
      ]);
      out.push({
        pullRequest: { ...mapped, ...deriveReadyForReview(raw.created_at, events) },
        approvals: extractApprovals(repo.repoKey, raw.number, reviews),
        approvalsAreComplete: true,
      });
    }
    return out;
  },
});
