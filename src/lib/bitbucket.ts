import type { CellMetrics } from "@/types";
import { getMonthRange, formatMonthKey } from "@/lib/dates";

const BITBUCKET_API = "https://api.bitbucket.org/2.0";

type BitbucketPR = {
  id: number;
  state: string;
  reviewers: Array<{ account_id: string }>;
  participants: Array<{ account_id: string; role: string; approved: boolean }>;
};

type BitbucketPRPage = {
  values: BitbucketPR[];
  next?: string;
};

const getAuthHeader = (): string => {
  const email = process.env.BITBUCKET_EMAIL;
  const token = process.env.BITBUCKET_API_TOKEN;
  if (!email || !token) {
    throw new Error("Missing BITBUCKET_EMAIL or BITBUCKET_API_TOKEN env vars");
  }
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
};

const fetchPage = async (url: string, auth: string): Promise<BitbucketPRPage> => {
  const res = await fetch(url, { headers: { Authorization: auth } });
  if (!res.ok) {
    throw new Error(`Bitbucket API error: ${res.status} ${res.statusText} — ${url}`);
  }
  return res.json();
};

const fetchAllPages = async (url: string, auth: string): Promise<BitbucketPR[]> => {
  const results: BitbucketPR[] = [];
  let nextUrl: string | undefined = url;
  while (nextUrl) {
    const page: BitbucketPRPage = await fetchPage(nextUrl, auth);
    results.push(...page.values);
    nextUrl = page.next;
  }
  return results;
};

// Fetch all PRs where the user was a reviewer (assigned to review) in the given time range across all repos
export const fetchAssignedReviews = async (
  accountId: string,
  workspace: string,
  repos: string[],
  since: string,
  until: string
): Promise<number> => {
  const auth = getAuthHeader();
  let total = 0;
  for (const repo of repos) {
    const url = `${BITBUCKET_API}/repositories/${workspace}/${repo}/pullrequests?state=MERGED&state=OPEN&state=DECLINED&q=reviewers.account_id="${accountId}" AND created_on>="${since}" AND created_on<"${until}"&fields=values.id,values.reviewers,values.participants&pagelen=50`;
    const prs = await fetchAllPages(url, auth);
    total += prs.length;
  }
  return total;
};

// Fetch all PRs where the user approved, in the given time range across all repos
export const fetchApprovedPRs = async (
  accountId: string,
  workspace: string,
  repos: string[],
  since: string,
  until: string
): Promise<number> => {
  const auth = getAuthHeader();
  let total = 0;
  for (const repo of repos) {
    const url = `${BITBUCKET_API}/repositories/${workspace}/${repo}/pullrequests?state=MERGED&state=OPEN&state=DECLINED&q=reviewers.account_id="${accountId}" AND created_on>="${since}" AND created_on<"${until}"&fields=values.id,values.participants&pagelen=50`;
    const prs = await fetchAllPages(url, auth);
    const approved = prs.filter((pr) =>
      pr.participants?.some((p) => p.account_id === accountId && p.approved)
    );
    total += approved.length;
  }
  return total;
};

// Fetch metrics for a single user across multiple months (each month is a separate range query)
export const fetchUserMonthlyMetrics = async (
  accountId: string,
  workspace: string,
  repos: string[],
  months: Array<{ year: number; month: number }>
): Promise<Record<string, CellMetrics>> => {
  const result: Record<string, CellMetrics> = {};
  for (const { year, month } of months) {
    const { since, until } = getMonthRange(year, month);
    const key = formatMonthKey(year, month);
    const [assignedToReview, approved] = await Promise.all([
      fetchAssignedReviews(accountId, workspace, repos, since, until),
      fetchApprovedPRs(accountId, workspace, repos, since, until),
    ]);
    result[key] = { assignedToReview, approved };
  }
  return result;
};
