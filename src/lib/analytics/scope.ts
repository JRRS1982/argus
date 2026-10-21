import type { PullRequestRecord, Service } from "@/types";

// Which PRs count as team activity: merged work plus work still in flight.
// CLOSED PRs are abandoned — counting them overstates output (declined and
// superseded PRs were roughly half of everything Bitbucket returned).
//
// Filtered on read rather than at fetch time on purpose: sync must keep
// collecting every state, otherwise a PR cached while OPEN would never be
// updated when it is later closed, and would count as in-flight forever.
export const countsAsActivity = (pr: PullRequestRecord): boolean =>
  pr.state === "MERGED" || pr.state === "OPEN";

// The population every tab draws from. Kept in one place so the tabs cannot
// disagree about which PRs exist: each of these rules used to be applied by
// some tabs and not others, which made the same engineer show different PR
// counts on the leaderboard and the PRs-created matrix.
//
// The default branch is keyed by provider+repoKey, not by service: a service that
// moved may have used `master` on Bitbucket and `main` on GitHub, and keying it on
// the service would silently drop one half of its own history.
export type PrScope = {
  defaultBranchByKey: Map<string, string>;
  includedServices: Set<number>;
};

const identityKey = (provider: string, repoKey: string): string => `${provider}:${repoKey}`;

export const buildPrScope = (services: Service[]): PrScope => ({
  defaultBranchByKey: new Map(
    services.flatMap((s) =>
      s.identities.map((i) => [identityKey(i.provider, i.repoKey), i.defaultBranch] as const),
    ),
  ),
  includedServices: new Set(services.filter((s) => s.included).map((s) => s.id)),
});

export const isInScope = (pr: PullRequestRecord, scope: PrScope): boolean =>
  countsAsActivity(pr) &&
  scope.includedServices.has(pr.serviceId) &&
  pr.destinationBranch === scope.defaultBranchByKey.get(identityKey(pr.provider, pr.repoKey));
