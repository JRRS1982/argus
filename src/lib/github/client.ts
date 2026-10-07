import { ProviderApiError } from "@/lib/providers/types";

export const GITHUB_API = "https://api.github.com";
export type FetchFn = typeof fetch;

// A subclass of ProviderApiError so provider-agnostic code can catch the base class,
// while the message names GITHUB_TOKEN rather than a Bitbucket variable.
export class GitHubApiError extends ProviderApiError {
  constructor(status: number, statusText: string, url: string, detail?: string) {
    super("github", "GitHub", ["GITHUB_TOKEN"], status, statusText, url);
    this.name = "GitHubApiError";
    if (detail) this.message = `${this.message} ${detail}`;
  }
}

// A non-ok response becomes a GitHubApiError. GitHub signals rate limiting with a 403
// as well as a 429: a secondary limit (Retry-After or an "abuse"/"secondary rate limit"
// body) and primary-limit exhaustion (x-ratelimit-remaining: 0). Both block the whole
// token, so they are reported as 429 here — at the HTTP layer — letting sync's existing
// 401/429 run-wide abort apply without sync reading provider headers. A plain
// permission 403 stays a 403, which really is per-repo.
const failure = async (res: Response, url: string): Promise<GitHubApiError> => {
  if (res.status !== 403) return new GitHubApiError(res.status, res.statusText, url);
  const retryAfter = res.headers.get("Retry-After");
  const exhausted = res.headers.get("x-ratelimit-remaining") === "0";
  const body = await res.text().catch(() => "");
  if (retryAfter || exhausted || /secondary rate limit|abuse/i.test(body)) {
    return new GitHubApiError(
      429, res.statusText, url,
      retryAfter ? `GitHub asks for a ${retryAfter}s wait (Retry-After).` : undefined,
    );
  }
  return new GitHubApiError(403, res.statusText, url);
};

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
  if (!res.ok) throw await failure(res, url);
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

// At 100 per page this is 100k items from one endpoint, far beyond any real repo.
const MAX_PAGES = 1000;

export const fetchAllPages = async <T>(
  firstUrl: string,
  token: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<T[]> => {
  const out: T[] = [];
  const origin = new URL(firstUrl).origin;
  const seen = new Set<string>();
  let next: string | undefined = firstUrl;
  while (next) {
    // GitHub never points elsewhere, but a proxy or buggy mock could: refuse to send
    // the bearer token to a different host, and refuse to loop forever on a repeated
    // or cyclic next link (which would hang a sync while `out` grows unbounded).
    if (new URL(next).origin !== origin) {
      throw new Error(`GitHub pagination pointed at a different host (${next}); refusing to send the token.`);
    }
    if (seen.has(next)) throw new Error(`GitHub pagination loop: ${next} was already fetched.`);
    if (seen.size >= MAX_PAGES) throw new Error(`GitHub pagination exceeded ${MAX_PAGES} pages from ${firstUrl}.`);
    seen.add(next);
    const res: Response = await fetchFn(next, { headers: headers(token) });
    if (!res.ok) throw await failure(res, next);
    out.push(...((await res.json()) as T[]));
    next = nextLink(res);
  }
  return out;
};

const GRAPHQL_STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401, RATE_LIMITED: 429, FORBIDDEN: 403, NOT_FOUND: 404,
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
  if (!res.ok) throw await failure(res, url);
  const body = (await res.json()) as { data: T; errors?: { type?: string; message: string }[] };
  // GraphQL reports failures in a 200 body, so a non-ok status is not the only check.
  // Known error types map to the HTTP status they mean, so callers get the same
  // credential guidance and run-wide 401/429 handling as REST. Unknown types stay a
  // plain Error: they are query bugs, not something sync should react to.
  const first = body.errors?.[0];
  if (first) {
    const status = first.type && GRAPHQL_STATUS[first.type];
    if (status) throw new GitHubApiError(status, first.type!, url);
    throw new Error(`GitHub GraphQL: ${first.message}`);
  }
  return body.data;
};
