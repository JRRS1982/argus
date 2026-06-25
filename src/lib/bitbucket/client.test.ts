import { describe, it, expect, vi } from "vitest";
import { fetchAllPages, bitbucketGet } from "@/lib/bitbucket/client";

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
