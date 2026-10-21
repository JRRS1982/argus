import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createProviderRegistry } from "./registry";
import { createFixtureProvider } from "./fixture";
import { createGitHubProvider } from "@/lib/github/adapter";

describe("provider registry", () => {
  it("looks providers up by id", () => {
    const gh = createGitHubProvider("o", "t", (() => {}) as never);
    expect(createProviderRegistry([gh]).get("github")).toBe(gh);
  });

  it("rejects a duplicate id, so the fixture can never shadow real GitHub data", () => {
    const gh = createGitHubProvider("o", "t", (() => {}) as never);
    expect(() => createProviderRegistry([gh, createFixtureProvider()])).toThrow(/registered twice/);
  });

  it("only tests import the fixture provider", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !p.endsWith("providers/fixture.ts")
          && /providers\/fixture|\.\/fixture/.test(readFileSync(p, "utf8"))) offenders.push(p);
      }
    };
    walk("src");
    expect(offenders).toEqual([]);
  });
});
