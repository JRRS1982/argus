import { describe, it, expect } from "vitest";
import { hasBitbucketCredentials, isDemoAvailable, isDemoDefaultOn } from "@/config";

const env = (over: Record<string, string | undefined>) => over as NodeJS.ProcessEnv;

describe("demo flags", () => {
  it("treats credentials as present only when both email and token are set", () => {
    expect(hasBitbucketCredentials(env({ BITBUCKET_EMAIL: "a@b.c", BITBUCKET_API_TOKEN: "t" }))).toBe(true);
    expect(hasBitbucketCredentials(env({ BITBUCKET_EMAIL: "a@b.c" }))).toBe(false);
    expect(hasBitbucketCredentials(env({ BITBUCKET_API_TOKEN: "t" }))).toBe(false);
    expect(hasBitbucketCredentials(env({}))).toBe(false);
  });

  it("offers the toggle in development even when credentials exist", () => {
    expect(isDemoAvailable(env({
      NODE_ENV: "development", BITBUCKET_EMAIL: "a@b.c", BITBUCKET_API_TOKEN: "t",
    }))).toBe(true);
  });

  it("offers the toggle in production only when credentials are absent", () => {
    expect(isDemoAvailable(env({ NODE_ENV: "production" }))).toBe(true);
    expect(isDemoAvailable(env({
      NODE_ENV: "production", BITBUCKET_EMAIL: "a@b.c", BITBUCKET_API_TOKEN: "t",
    }))).toBe(false);
  });

  it("defaults demo on exactly when there are no credentials to fetch with", () => {
    expect(isDemoDefaultOn(env({}))).toBe(true);
    expect(isDemoDefaultOn(env({ NODE_ENV: "development" }))).toBe(true);
    expect(isDemoDefaultOn(env({
      NODE_ENV: "development", BITBUCKET_EMAIL: "a@b.c", BITBUCKET_API_TOKEN: "t",
    }))).toBe(false);
  });
});
