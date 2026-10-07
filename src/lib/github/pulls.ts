import type { ApprovalRecord, Precision, PullRequestRecord } from "@/types";
import { GITHUB_API, fetchAllPages, type FetchFn } from "./client";
import { tagRepoLevel } from "@/lib/providers/repo-level";

export type RawPullRequest = {
  number: number; title: string; state: string;
  created_at: string; updated_at?: string; merged_at: string | null;
  user: { login: string } | null; base: { ref: string }; html_url: string;
};
type RawReview = { user: { login: string } | null; state: string; submitted_at: string | null };
type RawTimelineEvent = { event: string; created_at?: string };

type MappedPullRequest =
  Omit<PullRequestRecord, "serviceId" | "personId"> & { authorAccountId: string };

// merged_at decides MERGED, never `state`: GitHub reports both merged and
// closed-unmerged PRs as "closed", and counting the latter as merged would inflate
// every delivery number.
export const mapPullRequest = (repoKey: string, raw: RawPullRequest): MappedPullRequest => {
  const mergedOn = raw.merged_at ?? null;
  return {
    provider: "github", repoKey, number: raw.number, title: raw.title,
    state: mergedOn !== null ? "MERGED" : raw.state === "open" ? "OPEN" : "CLOSED",
    authorAccountId: raw.user?.login ?? "",
    createdOn: raw.created_at,
    // Summary detail: the list has no draft history, so creation time stands in.
    readyForReviewOn: raw.created_at, readyForReviewPrecision: "fallback",
    mergedOn,
    // GitHub reports the merge instant itself, unlike Bitbucket's updated_on proxy.
    mergedOnPrecision: mergedOn !== null ? "exact" : null,
    destinationBranch: raw.base.ref, url: raw.html_url,
  };
};

export const deriveReadyForReview = (
  createdOn: string, events: RawTimelineEvent[],
): { readyForReviewOn: string; readyForReviewPrecision: Precision } => {
  const times = events
    .filter((e) => e.event === "ready_for_review" && e.created_at)
    .map((e) => e.created_at as string)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return times.length > 0
    ? { readyForReviewOn: times[0], readyForReviewPrecision: "exact" }
    : { readyForReviewOn: createdOn, readyForReviewPrecision: "fallback" };
};

export const extractApprovals = (
  repoKey: string, prNumber: number, reviews: RawReview[],
): Omit<ApprovalRecord, "personId">[] => {
  const earliest = new Map<string, string>();
  for (const r of reviews) {
    if (r.state !== "APPROVED" || !r.user || !r.submitted_at) continue;
    const prev = earliest.get(r.user.login);
    if (prev === undefined || Date.parse(r.submitted_at) < Date.parse(prev)) {
      earliest.set(r.user.login, r.submitted_at);
    }
  }
  return [...earliest].map(([approverAccountId, approvedOn]) => ({
    provider: "github" as const, repoKey, prNumber, approverAccountId, approvedOn,
  }));
};

// The list cannot be filtered by updated_at server-side, but it can be sorted by it.
// Sorted newest-update first, the first page whose OLDEST entry predates `since` is
// the last one worth fetching — everything after it is older still. Fetching the whole
// history on every sync would burn the 5,000/hour limit across hundreds of repos.
export const fetchPullRequests = async (
  org: string, repoKey: string, since: string, token: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<RawPullRequest[]> => {
  const cursor = Date.parse(since);
  const url = `${GITHUB_API}/repos/${org}/${repoKey}/pulls?state=all&sort=updated&direction=desc&per_page=100`;
  let all: RawPullRequest[];
  try {
    all = await fetchAllPages<RawPullRequest>(url, token, fetchFn, (page) => {
      const oldest = page.at(-1)?.updated_at;
      return oldest !== undefined && Date.parse(oldest) < cursor;
    });
  } catch (err) {
    // Only this call speaks for the repo: a 404 here can mean it is gone.
    throw tagRepoLevel(err);
  }
  return all.filter((p) => p.updated_at === undefined || Date.parse(p.updated_at) >= cursor);
};

export const fetchReviews = (
  org: string, repoKey: string, number: number, token: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<RawReview[]> =>
  fetchAllPages<RawReview>(`${GITHUB_API}/repos/${org}/${repoKey}/pulls/${number}/reviews?per_page=100`, token, fetchFn);

export const fetchReadyForReview = (
  org: string, repoKey: string, number: number, token: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<RawTimelineEvent[]> =>
  fetchAllPages<RawTimelineEvent>(`${GITHUB_API}/repos/${org}/${repoKey}/issues/${number}/timeline?per_page=100`, token, fetchFn);
