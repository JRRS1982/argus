import { BITBUCKET_API, fetchAllPages, type FetchFn } from "./client";
import type { ApprovalRecord, PullRequestRecord, PullRequestState } from "@/types";

export type RawActivity = {
  approval?: { date: string; user: { account_id: string } };
  update?: { date: string; draft?: boolean };
};

type RawPr = {
  id: number;
  title: string;
  state: string;
  created_on: string;
  updated_on: string;
  author: { account_id: string };
  destination: { branch: { name: string } };
  links: { html: { href: string } };
};

// Earliest activity update that marks the PR non-draft = when it became ready for review.
export const deriveReadyForReview = (
  createdOn: string,
  activity: RawActivity[],
): { readyForReviewOn: string; readyIsFallback: boolean } => {
  const readyDates = activity
    .filter((a) => a.update && a.update.draft === false)
    .map((a) => a.update!.date)
    .sort();
  if (readyDates.length > 0) {
    return { readyForReviewOn: readyDates[0], readyIsFallback: false };
  }
  return { readyForReviewOn: createdOn, readyIsFallback: true };
};

export const extractApprovals = (
  repoSlug: string,
  prId: number,
  activity: RawActivity[],
): ApprovalRecord[] =>
  activity
    .filter((a) => a.approval)
    .map((a) => ({
      repoSlug,
      prId,
      approverAccountId: a.approval!.user.account_id,
      approvedOn: a.approval!.date ?? null,
    }));

export const fetchPullRequestsUpdatedSince = async (
  workspace: string,
  repoSlug: string,
  sinceIso: string,
  auth: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<Omit<PullRequestRecord, "readyForReviewOn" | "readyIsFallback">[]> => {
  const states = "state=MERGED&state=OPEN&state=DECLINED&state=SUPERSEDED";
  const q = encodeURIComponent(`updated_on>="${sinceIso}"`);
  const fields = "fields=values.id,values.title,values.state,values.created_on,values.updated_on," +
    "values.author.account_id,values.destination.branch.name,values.links.html.href,next";
  const url = `${BITBUCKET_API}/repositories/${workspace}/${repoSlug}/pullrequests?${states}&q=${q}&pagelen=50&${fields}`;
  const raw = await fetchAllPages<RawPr>(url, auth, fetchFn);
  return raw.map((p) => ({
    id: p.id,
    repoSlug,
    authorAccountId: p.author.account_id,
    title: p.title,
    state: p.state as PullRequestState,
    createdOn: p.created_on,
    mergedOn: p.state === "MERGED" ? p.updated_on : null,
    destinationBranch: p.destination.branch.name,
    url: p.links.html.href,
  }));
};

export const fetchPullRequestActivity = async (
  workspace: string,
  repoSlug: string,
  prId: number,
  auth: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<RawActivity[]> => {
  const url = `${BITBUCKET_API}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/activity?pagelen=50`;
  return fetchAllPages<RawActivity>(url, auth, fetchFn);
};
