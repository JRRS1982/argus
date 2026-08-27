import { describe, it, expect, vi } from "vitest";
import { fetchAllPages, bitbucketGet, BitbucketApiError, describeHttpFailure } from "@/lib/bitbucket/client";

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, statusText: "OK", json: async () => body }) as Response;

describe("fetchAllPages", () => {
  it("follows the next cursor and concatenates values", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ values: [{ id: 1 }, { id: 2 }], next: "page2" }))
      .mockResolvedValueOnce(jsonResponse({ values: [{ id: 3 }] }));
    const all = await fetchAllPages<{ id: number }>("page1", "auth", fetchFn as unknown as typeof fetch);
    expect(all.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("bitbucketGet", () => {
  it("throws a descriptive error on non-ok responses", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" } as Response);
    await expect(bitbucketGet("u", "auth", fetchFn as unknown as typeof fetch)).rejects.toThrow(/404/);
  });
});

describe("BitbucketApiError", () => {
  it("keeps the status and url for callers while reading in plain English", async () => {
    const url = "https://api.bitbucket.org/2.0/repositories/ws/gone/pullrequests?state=MERGED&q=x";
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" } as Response);
    const err: unknown = await bitbucketGet("x", "auth", fetchFn as unknown as typeof fetch).catch((e) => e);

    expect(err).toBeInstanceOf(BitbucketApiError);
    expect((err as BitbucketApiError).status).toBe(404);
    // The URL stays available for logs, but the message a user reads must not be a
    // wall of query string — that was the original complaint.
    expect(new BitbucketApiError(404, "Not Found", url).message).not.toContain("state=MERGED");
  });

  it("explains each status a sync can realistically hit", () => {
    expect(describeHttpFailure(401, "Unauthorized")).toMatch(/BITBUCKET_API_TOKEN/);
    expect(describeHttpFailure(403, "Forbidden")).toMatch(/denied/i);
    expect(describeHttpFailure(404, "Not Found")).toMatch(/no longer exists/i);
    expect(describeHttpFailure(429, "Too Many Requests")).toMatch(/rate limit/i);
    expect(describeHttpFailure(503, "Service Unavailable")).toMatch(/unavailable/i);
    expect(describeHttpFailure(418, "I'm a teapot")).toMatch(/418/);
  });
});
