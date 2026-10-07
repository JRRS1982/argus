import { ProviderApiError } from "@/lib/providers/types";

export const GITHUB_API = "https://api.github.com";
export type FetchFn = typeof fetch;

// A subclass of ProviderApiError so provider-agnostic code can catch the base class,
// while the message names GITHUB_TOKEN rather than a Bitbucket variable.
export class GitHubApiError extends ProviderApiError {
  constructor(status: number, statusText: string, url: string) {
    super("github", "GitHub", ["GITHUB_TOKEN"], status, statusText, url);
    this.name = "GitHubApiError";
  }
}

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

export const githubGet = async <T>(
  url: string,
  token: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<T> => {
  const res = await fetchFn(url, { headers: headers(token) });
  if (!res.ok) throw new GitHubApiError(res.status, res.statusText, url);
  return (await res.json()) as T;
};

// GitHub paginates with a Link header rather than a `next` field in the body, so the
// Bitbucket pager cannot be reused. A header carries several relations at once
// (`<..>; rel="prev", <..>; rel="next", <..>; rel="last"`), so each `<url>` entry is
// matched with its own parameters and only the one whose rel is `next` is returned.
// Splitting on "," would be wrong: a URL's query string may itself contain commas.
// Missing it would silently stop at page 1 and under-report history without failing.
const nextLink = (res: Response): string | undefined => {
  const header = res.headers.get("Link");
  if (!header) return undefined;
  for (const [, url, params] of header.matchAll(/<([^>]+)>([^<]*)/g)) {
    const rel = /rel\s*=\s*"?([^";]+)"?/i.exec(params)?.[1];
    if (rel?.split(/\s+/).includes("next")) return url;
  }
  return undefined;
};

export const fetchAllPages = async <T>(
  firstUrl: string,
  token: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<T[]> => {
  const out: T[] = [];
  let next: string | undefined = firstUrl;
  while (next) {
    const res: Response = await fetchFn(next, { headers: headers(token) });
    if (!res.ok) throw new GitHubApiError(res.status, res.statusText, next);
    out.push(...((await res.json()) as T[]));
    next = nextLink(res);
  }
  return out;
};

export const graphql = async <T>(
  query: string,
  variables: Record<string, unknown>,
  token: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<T> => {
  const url = `${GITHUB_API}/graphql`;
  const res = await fetchFn(url, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new GitHubApiError(res.status, res.statusText, url);
  const body = (await res.json()) as { data: T; errors?: { message: string }[] };
  // GraphQL reports failures in a 200 body, so a non-ok status is not the only check.
  if (body.errors?.length) throw new Error(`GitHub GraphQL: ${body.errors[0].message}`);
  return body.data;
};
