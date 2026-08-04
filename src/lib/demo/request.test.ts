import { describe, it, expect } from "vitest";
import { isDemoRequest } from "@/lib/demo/request";

const env = (over: Record<string, string | undefined>) => over as NodeJS.ProcessEnv;
const CREDENTIALED = env({
  NODE_ENV: "production", BITBUCKET_EMAIL: "a@b.c", BITBUCKET_API_TOKEN: "t",
});
const BARE = env({ NODE_ENV: "production" });

describe("isDemoRequest", () => {
  it("is true when demo=1 and demo mode is available", () => {
    expect(isDemoRequest(new URL("http://x/api/insights?demo=1"), BARE)).toBe(true);
  });

  it("is false without the query parameter", () => {
    expect(isDemoRequest(new URL("http://x/api/insights"), BARE)).toBe(false);
  });

  it("refuses demo=1 on a credentialed production instance", () => {
    expect(isDemoRequest(new URL("http://x/api/insights?demo=1"), CREDENTIALED)).toBe(false);
  });

  it("allows demo=1 in development even with credentials", () => {
    expect(isDemoRequest(
      new URL("http://x/api/insights?demo=1"),
      env({ NODE_ENV: "development", BITBUCKET_EMAIL: "a@b.c", BITBUCKET_API_TOKEN: "t" }),
    )).toBe(true);
  });
});
