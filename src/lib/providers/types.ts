import type { ApprovalRecord, ProviderId, PullRequestRecord } from "@/types";

// What a provider can tell us exactly, versus what we must derive or fetch per PR.
// Analytics and the UI read these to word their caveats honestly instead of
// assuming every provider is as precise as the best one.
export type ProviderCapabilities = {
  // "derived" = no merge timestamp is exposed and a stand-in (Bitbucket's updated_on) is used.
  mergeTimestamps: "exact" | "derived";
  // "onDemand" = obtainable, but only at the cost of one extra request per PR.
  readyForReviewTimestamps: "exact" | "onDemand" | "unavailable";
  approvalTimestamps: "exact" | "onDemand" | "unavailable";
};

// "summary" = list calls only (cheap, coarser); "full" = per-PR detail (precise, costly).
export type DetailLevel = "summary" | "full";

export type RepositoryRef = { repoKey: string; defaultBranch: string };

// Provider vocabulary in, canonical ids out: the adapter leaves serviceId/personId off
// because only sync, which owns the database, may resolve them to canonical ids.
export type FetchedPullRequest = {
  pullRequest: Omit<PullRequestRecord, "serviceId" | "personId"> & { authorAccountId: string };
  approvals: Omit<ApprovalRecord, "personId">[];
  // false: the list came from a summary endpoint that cannot see withdrawn approvals,
  //        so storage must MERGE it into what is already held.
  // true:  the list is authoritative history, so storage REPLACES what is held.
  approvalsAreComplete: boolean;
};

export type PullRequestProvider = {
  readonly id: ProviderId;
  readonly label: string;
  readonly capabilities: ProviderCapabilities;
  listPeople(): Promise<{ accountId: string; displayName: string }[]>;
  listRepositories(): Promise<
    { repoKey: string; name: string; defaultBranch: string; groupKey: string | null }[]
  >;
  listPullRequests(
    repo: RepositoryRef,
    updatedSince: string,
    detail: DetailLevel,
  ): Promise<FetchedPullRequest[]>;
};

// Plain-English cause for an HTTP status, phrased so a caller can prefix it with
// what it was fetching. It takes the provider's own label and credential variables so
// a GitHub 401 says "check GITHUB_TOKEN" rather than sending the user to edit a
// Bitbucket variable. The raw request URL is deliberately absent: a PR query string
// is ~400 characters of states and field selectors, noise in a UI message. It stays
// on ProviderApiError.url for logs.
export const describeHttpFailure = (
  provider: { label: string; credentialVars: string[] },
  status: number,
  statusText: string,
): string => {
  const vars = provider.credentialVars.length === 1
    ? provider.credentialVars[0]
    : `${provider.credentialVars.slice(0, -1).join(", ")} and ${provider.credentialVars.at(-1)}`;
  switch (status) {
    case 401: return `${provider.label} rejected the credentials (401) — check ${vars}.`;
    case 403: return "Access denied (403) — the token lacks permission for this resource.";
    case 404: return "Not found (404) — it no longer exists, or the token cannot see it.";
    case 429: return `Hit ${provider.label}'s rate limit (429) — wait a minute, then try again.`;
    default:
      return status >= 500
        ? `${provider.label} is unavailable (${status} ${statusText}) — try again shortly.`
        : `${provider.label} API error: ${status} ${statusText}.`;
  }
};

export class ProviderApiError extends Error {
  readonly provider: ProviderId;
  readonly status: number;
  readonly statusText: string;
  readonly url: string;

  constructor(
    provider: ProviderId, label: string, credentialVars: string[],
    status: number, statusText: string, url: string,
  ) {
    super(describeHttpFailure({ label, credentialVars }, status, statusText));
    this.name = "ProviderApiError";
    this.provider = provider;
    this.status = status;
    this.statusText = statusText;
    this.url = url;
  }
}
