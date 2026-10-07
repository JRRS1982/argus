import { describe, it, expect, vi } from "vitest";
import { fetchAllPages, githubGet, graphql, GitHubApiError } from "@/lib/github/client";

const page = (body: unknown, next?: string) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: next ? { Link: `<${next}>; rel="next"` } : {},
  });

const withLink = (body: unknown, link: string) =>
  new Response(JSON.stringify(body), { status: 200, headers: { Link: link } });

describe("github client", () => {
  it("sends a bearer token and the versioned Accept header", async () => {
    const fetchFn = vi.fn().mockResolvedValue(page({ ok: true }));
    await githubGet("https://api.github.com/user", "tok", fetchFn);
    const [, init] = fetchFn.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.headers.Accept).toBe("application/vnd.github+json");
  });

  it("follows Link rel=next until it is absent", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(page([{ id: 1 }], "https://api.github.com/x?page=2"))
      .mockResolvedValueOnce(page([{ id: 2 }]));
    const all = await fetchAllPages<{ id: number }>("https://api.github.com/x", "tok", fetchFn);
    expect(all.map((r) => r.id)).toEqual([1, 2]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("picks rel=next out of a header carrying prev, next and last", async () => {
    const link =
      '<https://api.github.com/x?page=1>; rel="prev", ' +
      '<https://api.github.com/x?page=3>; rel="next", ' +
      '<https://api.github.com/x?page=9>; rel="last"';
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(withLink([{ id: 1 }], link))
      .mockResolvedValueOnce(page([{ id: 2 }]));
    await fetchAllPages("https://api.github.com/x", "tok", fetchFn);
    expect(fetchFn.mock.calls[1][0]).toBe("https://api.github.com/x?page=3");
  });

  it("finds rel=next when it is not the first relation", async () => {
    const link = '<https://api.github.com/x?page=1>; rel="first", <https://api.github.com/x?page=2>; rel="next"';
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(withLink([], link))
      .mockResolvedValueOnce(page([]));
    await fetchAllPages("https://api.github.com/x", "tok", fetchFn);
    expect(fetchFn.mock.calls[1][0]).toBe("https://api.github.com/x?page=2");
  });

  it("does not follow a header that has only prev and last (final page)", async () => {
    const link = '<https://api.github.com/x?page=1>; rel="prev", <https://api.github.com/x?page=1>; rel="first"';
    const fetchFn = vi.fn().mockResolvedValue(withLink([{ id: 1 }], link));
    await fetchAllPages("https://api.github.com/x", "tok", fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("keeps a URL containing a comma intact", async () => {
    const link = '<https://api.github.com/x?q=a,b&page=2>; rel="next"';
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(withLink([], link))
      .mockResolvedValueOnce(page([]));
    await fetchAllPages("https://api.github.com/x", "tok", fetchFn);
    expect(fetchFn.mock.calls[1][0]).toBe("https://api.github.com/x?q=a,b&page=2");
  });

  it("stops at a single page when no Link header is present", async () => {
    const fetchFn = vi.fn().mockResolvedValue(page([{ id: 1 }]));
    await fetchAllPages("https://api.github.com/x", "tok", fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("throws a GitHubApiError naming GITHUB_TOKEN on 401", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("{}", { status: 401, statusText: "Unauthorized" }));
    await expect(githubGet("https://api.github.com/x", "tok", fetchFn))
      .rejects.toThrow(/GitHub rejected the credentials \(401\) — check GITHUB_TOKEN\./);
  });

  it("carries status and url on the error for logging", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("{}", { status: 404, statusText: "Not Found" }));
    const err = (await githubGet("https://api.github.com/repos/o/r/pulls", "tok", fetchFn).catch((e) => e)) as GitHubApiError;
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err.status).toBe(404);
    expect(err.url).toBe("https://api.github.com/repos/o/r/pulls");
  });

  it("reports the page URL that failed mid-pagination", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(page([{ id: 1 }], "https://api.github.com/x?page=2"))
      .mockResolvedValueOnce(new Response("{}", { status: 502, statusText: "Bad Gateway" }));
    const err = await fetchAllPages("https://api.github.com/x", "tok", fetchFn).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err.url).toBe("https://api.github.com/x?page=2");
  });
});

describe("github graphql", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("posts query and variables and returns data", async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok({ data: { viewer: { login: "a" } } }));
    const data = await graphql<{ viewer: { login: string } }>("query { viewer { login } }", { n: 1 }, "tok", fetchFn);
    expect(data.viewer.login).toBe("a");
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.github.com/graphql");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ query: "query { viewer { login } }", variables: { n: 1 } });
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("throws on an errors array inside a 200 response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok({ data: null, errors: [{ message: "Bad field" }] }));
    await expect(graphql("q", {}, "tok", fetchFn)).rejects.toThrow(/Bad field/);
  });

  it("throws GitHubApiError on a non-ok status", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("{}", { status: 401, statusText: "Unauthorized" }));
    await expect(graphql("q", {}, "tok", fetchFn)).rejects.toBeInstanceOf(GitHubApiError);
  });
});
