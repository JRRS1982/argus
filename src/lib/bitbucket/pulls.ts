import { BITBUCKET_API, fetchAllPages, type FetchFn } from "./client";
import type { PullRequestState } from "@/types";

export type RawActivity = {
  approval?: { date: string; user: { account_id: string } };
  update?: { date: string; draft?: boolean };
};

// Current approval state as returned inline on the PR list endpoint.
export type RawParticipant = {
  approved?: boolean;
  user?: { account_id: string };
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
  participants?: RawParticipant[];
};

// Bitbucket's own vocabulary: slugs and account ids. Sync resolves these to canonical
// service and person ids when it stores them, so this module never touches the database.
export type BitbucketApproval = {
  repoSlug: string;
  prId: number;
  approverAccountId: string;
  approvedOn: string | null;
};

// A PR as known from the list endpoint alone: no draft-transition history, but
// approvals are already present via participants[].
export type PullRequestPartial = {
  id: number;
  repoSlug: string;
  authorAccountId: string;
  title: string;
  state: PullRequestState;
  createdOn: string;
  mergedOn: string | null;
  destinationBranch: string;
  url: string;
  approvals: BitbucketApproval[];
};

// DECLINED and SUPERSEDED both mean abandoned work; nothing downstream distinguishes them.
const toState = (raw: string): PullRequestState =>
  raw === "MERGED" || raw === "OPEN" ? raw : "CLOSED";

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
): BitbucketApproval[] =>
  activity
    .filter((a) => a.approval)
    .map((a) => ({
      repoSlug,
      prId,
      approverAccountId: a.approval!.user.account_id,
      approvedOn: a.approval!.date ?? null,
    }));

// Approvals as currently recorded on the PR itself. No timestamps are available
// here, and approvals withdrawn or reset by later commits are simply absent —
// the activity feed (extractApprovals) is the authoritative history.
export const extractApprovalsFromParticipants = (
  repoSlug: string,
  prId: number,
  participants: RawParticipant[] = [],
): BitbucketApproval[] =>
  participants
    .filter((p) => p.approved === true && p.user?.account_id)
    .map((p) => ({
      repoSlug,
      prId,
      approverAccountId: p.user!.account_id,
      approvedOn: null,
    }));

export const fetchPullRequestsUpdatedSince = async (
  workspace: string,
  repoSlug: string,
  sinceIso: string,
  auth: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<PullRequestPartial[]> => {
  const states = "state=MERGED&state=OPEN&state=DECLINED&state=SUPERSEDED";
  const q = encodeURIComponent(`updated_on>="${sinceIso}"`);
  const fields = "fields=values.id,values.title,values.state,values.created_on,values.updated_on," +
    "values.author.account_id,values.destination.branch.name,values.links.html.href," +
    "values.participants.approved,values.participants.user.account_id,next";
  const url = `${BITBUCKET_API}/repositories/${workspace}/${repoSlug}/pullrequests?${states}&q=${q}&pagelen=50&${fields}`;
  const raw = await fetchAllPages<RawPr>(url, auth, fetchFn);
  return raw.map((p) => ({
    id: p.id,
    repoSlug,
    authorAccountId: p.author.account_id,
    title: p.title,
    state: toState(p.state),
    createdOn: p.created_on,
    mergedOn: p.state === "MERGED" ? p.updated_on : null,
    destinationBranch: p.destination.branch.name,
    url: p.links.html.href,
    approvals: extractApprovalsFromParticipants(repoSlug, p.id, p.participants),
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
