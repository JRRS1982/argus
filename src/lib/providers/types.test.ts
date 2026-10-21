import { describe, it, expect } from "vitest";
import { ProviderApiError, describeHttpFailure } from "@/lib/providers/types";

const bitbucket = { label: "Bitbucket", credentialVars: ["BITBUCKET_EMAIL", "BITBUCKET_API_TOKEN"] };
const github = { label: "GitHub", credentialVars: ["GITHUB_TOKEN"] };

describe("describeHttpFailure", () => {
  it("names the provider's own credential variables on 401", () => {
    expect(describeHttpFailure(bitbucket, 401, "Unauthorized"))
      .toBe("Bitbucket rejected the credentials (401) — check BITBUCKET_EMAIL and BITBUCKET_API_TOKEN.");
    expect(describeHttpFailure(github, 401, "Unauthorized"))
      .toBe("GitHub rejected the credentials (401) — check GITHUB_TOKEN.");
  });

  it("describes 403, 404, 429 and 5xx in plain English", () => {
    expect(describeHttpFailure(github, 403, "Forbidden")).toMatch(/Access denied \(403\)/);
    expect(describeHttpFailure(github, 404, "Not Found")).toMatch(/Not found \(404\)/);
    expect(describeHttpFailure(github, 429, "Too Many Requests")).toMatch(/rate limit \(429\)/);
    expect(describeHttpFailure(github, 503, "Unavailable")).toMatch(/GitHub is unavailable \(503/);
  });

  it("keeps the request URL off the message but on the error", () => {
    const err = new ProviderApiError("github", "GitHub", ["GITHUB_TOKEN"], 404, "Not Found", "https://api/x?fields=a,b,c");
    // A PR query string is ~400 characters of state and field selectors — noise in a
    // UI message, but the only record of which URL was refused, so it goes to logs.
    expect(err.message).not.toContain("https://");
    expect(err.url).toBe("https://api/x?fields=a,b,c");
    expect(err.status).toBe(404);
    expect(err.provider).toBe("github");
  });
});
