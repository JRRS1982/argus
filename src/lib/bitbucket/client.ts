export const BITBUCKET_API = "https://api.bitbucket.org/2.0";

export type FetchFn = typeof fetch;

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
    throw new Error(`Bitbucket API error: ${res.status} ${res.statusText} — ${url}`);
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
