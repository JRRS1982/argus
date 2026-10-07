import { describe, it, expect } from "vitest";
import { createConfiguredRegistry } from "./configured";

const env = (e: Record<string, string> = {}) => e as unknown as NodeJS.ProcessEnv;
const cfg = { workspace: "ws", projectKey: null, githubToken: null as string | null, githubOrg: "org" };

describe("createConfiguredRegistry", () => {
  it("activates only providers that have credentials", () => {
    expect(createConfiguredRegistry(cfg, env()).all()).toEqual([]);
    expect(createConfiguredRegistry({ ...cfg, githubToken: "t" }, env()).all().map((p) => p.id)).toEqual(["github"]);
    const both = createConfiguredRegistry({ ...cfg, githubToken: "t" }, env({ BITBUCKET_EMAIL: "e", BITBUCKET_API_TOKEN: "k" }));
    expect(both.all().map((p) => p.id).sort()).toEqual(["bitbucket", "github"]);
  });

  it("does not call a provider that is not active", () => {
    expect(() => createConfiguredRegistry(cfg, env()).get("github")).toThrow(/No provider registered/);
  });
});
