import type { PullRequestRecord, RepoRecord } from "@/types";

// Which PRs count as team activity: merged work plus work still in flight.
// DECLINED and SUPERSEDED PRs are abandoned — counting them overstates output
// (they are roughly half of everything Bitbucket returns).
//
// Filtered on read rather than at fetch time on purpose: sync must keep
// collecting every state, otherwise a PR cached while OPEN would never be
// updated when it is later declined, and would count as in-flight forever.
export const countsAsActivity = (pr: PullRequestRecord): boolean =>
  pr.state === "MERGED" || pr.state === "OPEN";

// The population every tab draws from. Kept in one place so the tabs cannot
// disagree about which PRs exist: each of these rules used to be applied by
// some tabs and not others, which made the same engineer show different PR
// counts on the leaderboard and the PRs-created matrix.
export type PrScope = {
  mainBranchBySlug: Map<string, string>;
  includedRepos: Set<string>;
};

export const buildPrScope = (repos: RepoRecord[]): PrScope => ({
  mainBranchBySlug: new Map(repos.map((r) => [r.slug, r.mainBranch])),
  includedRepos: new Set(repos.filter((r) => r.included).map((r) => r.slug)),
});

export const isInScope = (pr: PullRequestRecord, scope: PrScope): boolean =>
  countsAsActivity(pr) &&
  scope.includedRepos.has(pr.repoSlug) &&
  pr.destinationBranch === scope.mainBranchBySlug.get(pr.repoSlug);
