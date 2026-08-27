export const BITBUCKET_API = "https://api.bitbucket.org/2.0";

export type FetchFn = typeof fetch;

// Plain-English cause for an HTTP status, phrased so a caller can prefix it with
// what it was fetching ("benchmarkme: Not found (404) — …"). The raw request URL
// is deliberately absent: a Bitbucket PR URL carries a ~400-character query
// string of states and field selectors, which is noise in a UI message. It stays
// on BitbucketApiError.url for logs.
export const describeHttpFailure = (status: number, statusText: string): string => {
  switch (status) {
    case 401:
      return "Bitbucket rejected the credentials (401) — check BITBUCKET_EMAIL and BITBUCKET_API_TOKEN.";
    case 403:
      return "Access denied (403) — the API token lacks permission for this resource.";
    case 404:
      return "Not found (404) — it no longer exists in this workspace, or the token cannot see it.";
    case 429:
      return "Hit Bitbucket's rate limit (429) — wait a minute, then try again.";
    default:
      return status >= 500
        ? `Bitbucket is unavailable (${status} ${statusText}) — try again shortly.`
        : `Bitbucket API error: ${status} ${statusText}.`;
  }
};

export class BitbucketApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;

  constructor(status: number, statusText: string, url: string) {
    super(describeHttpFailure(status, statusText));
    this.name = "BitbucketApiError";
    this.status = status;
    this.statusText = statusText;
    this.url = url;
  }
}

export const getAuthHeader = (): string => {
  const email = process.env.BITBUCKET_EMAIL;
  const token = process.env.BITBUCKET_API_TOKEN;
  if (!email || !token) {
    throw new Error("Missing BITBUCKET_EMAIL or BITBUCKET_API_TOKEN env vars");
  }
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
};

export const bitbucketGet = async <T>(
  url: string,
  auth: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<T> => {
  const res = await fetchFn(url, { headers: { Authorization: auth } });
  if (!res.ok) {
    throw new BitbucketApiError(res.status, res.statusText, url);
  }
  return (await res.json()) as T;
};

type Page<T> = { values: T[]; next?: string };

export const fetchAllPages = async <T>(
  firstUrl: string,
  auth: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<T[]> => {
  const out: T[] = [];
  let next: string | undefined = firstUrl;
  while (next) {
    const page: Page<T> = await bitbucketGet<Page<T>>(next, auth, fetchFn);
    out.push(...page.values);
    next = page.next;
  }
  return out;
};
