import type { PullRequestProvider, FetchedPullRequest } from "@/lib/providers/types";
import { tagRepoLevel } from "@/lib/providers/repo-level";
import type { FetchFn } from "./client";
import { fetchWorkspaceMembers, fetchRepos } from "./discover";
import {
  fetchPullRequestsUpdatedSince, fetchPullRequestActivity,
  deriveReadyForReview, extractApprovals,
} from "./pulls";

export type BitbucketProviderConfig = {
  workspace: string;
  projectKey: string | null;
  auth: string;
  fetchFn?: FetchFn;
};

// Bitbucket behind the provider port.
//
// NOTE: listPullRequests is never invoked in normal operation. Bitbucket is a frozen,
// read-only archive and is not fetched again. This adapter is kept so that re-enabling
// it is a config flip rather than a rewrite, and so the port has a second real
// implementation keeping it honest about what it asks of a provider.
export const createBitbucketProvider = (cfg: BitbucketProviderConfig): PullRequestProvider => {
  const fetchFn = cfg.fetchFn ?? globalThis.fetch;
  return {
    id: "bitbucket",
    label: "Bitbucket",
    // derived: the PR list exposes no merge timestamp, so updated_on stands in for it.
    // onDemand: ready times and approval dates exist only in the per-PR activity feed.
    capabilities: {
      mergeTimestamps: "derived",
      readyForReviewTimestamps: "onDemand",
      approvalTimestamps: "onDemand",
    },

    listPeople: () => fetchWorkspaceMembers(cfg.workspace, cfg.auth, fetchFn),

    listRepositories: async () =>
      (await fetchRepos(cfg.workspace, cfg.projectKey, cfg.auth, fetchFn)).map((r) => ({
        repoKey: r.slug, name: r.name, defaultBranch: r.mainBranch, groupKey: r.projectKey,
      })),

    listPullRequests: async (repo, updatedSince, detail) => {
      // Tagged here, on the PR-list call alone: a 404 from one PR's activity feed below
      // must never read as "this repo is gone".
      const partials = await fetchPullRequestsUpdatedSince(
        cfg.workspace, repo.repoKey, updatedSince, cfg.auth, fetchFn,
      ).catch((err) => { throw tagRepoLevel(err); });
      const out: FetchedPullRequest[] = [];
      for (const p of partials) {
        const { approvals: participantApprovals, id, repoSlug, ...rest } = p;
        const base = {
          ...rest, provider: "bitbucket", repoKey: repoSlug, number: id,
          mergedOnPrecision: p.mergedOn === null ? null : "derived",
        } as const;
        const toApproval = (a: { approverAccountId: string; approvedOn: string | null }) => ({
          provider: "bitbucket" as const, repoKey: repoSlug, prNumber: id,
          approverAccountId: a.approverAccountId, approvedOn: a.approvedOn,
        });

        if (detail === "summary") {
          // participants[] shows current approvals only: a withdrawn one is simply absent,
          // so storage must merge rather than replace.
          out.push({
            pullRequest: { ...base, readyForReviewOn: p.createdOn, readyForReviewPrecision: "fallback" },
            approvals: participantApprovals.map(toApproval),
            approvalsAreComplete: false,
          });
          continue;
        }
        const activity = await fetchPullRequestActivity(cfg.workspace, repoSlug, id, cfg.auth, fetchFn);
        const { readyForReviewOn, readyIsFallback } = deriveReadyForReview(p.createdOn, activity);
        out.push({
          pullRequest: {
            ...base, readyForReviewOn, readyForReviewPrecision: readyIsFallback ? "fallback" : "derived",
          },
          approvals: extractApprovals(repoSlug, id, activity).map(toApproval),
          approvalsAreComplete: true,
        });
      }
      return out;
    },
  };
};
