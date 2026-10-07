// Drives the real POST /api/discover against an in-memory database seeded with a
// Bitbucket-era roster, with GitHub supplied by fakes. Failure scenario: if this is
// wrong, a user sees a repo or engineer's history split in two, or two different
// services fused, or a ticked choice silently flipped by clicking Discover.
import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { applySchema } from "@/lib/db/schema";
import { upsertBitbucketUsers, upsertBitbucketRepos } from "@/lib/db/queries";
import { getPeople, getServices, setServiceIncluded, setPersonIncluded } from "@/lib/db/canonical";

const h = vi.hoisted(() => ({
  db: null as unknown as import("better-sqlite3").Database,
  ghRepos: [] as { repoKey: string; name: string; defaultBranch: string; groupKey: null }[],
  ghPeople: [] as { accountId: string; displayName: string }[],
}));

vi.mock("@/lib/db", () => ({ getDb: () => h.db }));
vi.mock("@/config", () => ({
  config: { workspace: "ws", projectKey: null, dbPath: ":memory:", githubToken: "tok", githubOrg: "org" },
}));
vi.mock("@/lib/bitbucket/client", () => ({ getAuthHeader: () => "Basic x" }));
vi.mock("@/lib/bitbucket/discover", () => ({
  fetchWorkspaceMembers: async () => [
    { accountId: "bb-alice", displayName: "Alice Smith" },
    { accountId: "bb-bob", displayName: "Bob Jones" },
  ],
  fetchRepos: async () => [
    { slug: "chameleon-gateway", name: "chameleon-gateway", projectKey: "CH", mainBranch: "main" },
    { slug: "chameleon-qa", name: "chameleon-qa", projectKey: "CH", mainBranch: "main" },
    { slug: "benchmarkmeapp", name: "benchmarkmeapp", projectKey: "BM", mainBranch: "main" },
  ],
}));
vi.mock("@/lib/github/adapter", () => ({
  createGitHubProvider: () => ({
    id: "github", label: "GitHub",
    capabilities: { mergeTimestamps: "exact", readyForReviewTimestamps: "onDemand", approvalTimestamps: "onDemand" },
    listRepositories: async () => h.ghRepos,
    listPeople: async () => h.ghPeople,
    listPullRequests: async () => [],
  }),
}));

import { POST } from "@/app/api/discover/route";

const call = () => POST(new NextRequest("http://localhost/api/discover", { method: "POST" }));
const snapshot = () => JSON.stringify([getServices(h.db), getPeople(h.db)]);

describe("POST /api/discover — GitHub auto-linking", () => {
  beforeEach(() => {
    h.db = new Database(":memory:");
    applySchema(h.db);
    // The Bitbucket-era roster, with a ticked choice for each kind of entity.
    upsertBitbucketUsers(h.db, [
      { accountId: "bb-alice", displayName: "Alice Smith" },
      { accountId: "bb-bob", displayName: "Bob Jones" },
    ]);
    upsertBitbucketRepos(h.db, [
      { slug: "chameleon-gateway", name: "chameleon-gateway", projectKey: "CH", mainBranch: "main" },
      { slug: "chameleon-qa", name: "chameleon-qa", projectKey: "CH", mainBranch: "main" },
      { slug: "benchmarkmeapp", name: "benchmarkmeapp", projectKey: "BM", mainBranch: "main" },
    ]);
    const gateway = getServices(h.db).find((s) => s.name === "chameleon-gateway")!;
    setServiceIncluded(h.db, gateway.id, true);
    setPersonIncluded(h.db, getPeople(h.db).find((p) => p.displayName === "Alice Smith")!.id, true);
    h.ghRepos = [
      { repoKey: "Chameleon_Gateway", name: "Chameleon_Gateway", defaultBranch: "main", groupKey: null },
      { repoKey: "chameleon-acceptance-tests", name: "chameleon-acceptance-tests", defaultBranch: "main", groupKey: null },
      { repoKey: "benchmarkme", name: "benchmarkme", defaultBranch: "main", groupKey: null },
    ];
    h.ghPeople = [
      { accountId: "alice-gh", displayName: "alice smith" },
      { accountId: "newbie", displayName: "newbie" },
    ];
  });

  it("links exact matches as second identities and creates the rest excluded", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const services = getServices(h.db);

    const gateway = services.find((s) => s.name === "chameleon-gateway")!;
    expect(gateway.identities.map((i) => i.provider).sort()).toEqual(["bitbucket", "github"]);
    expect(gateway.identities.find((i) => i.provider === "github")!.repoKey).toBe("Chameleon_Gateway");

    // Near-misses stay apart: separate, excluded, single-identity services.
    for (const name of ["chameleon-acceptance-tests", "benchmarkme"]) {
      const s = services.find((x) => x.name === name)!;
      expect(s.included).toBe(false);
      expect(s.identities.map((i) => i.provider)).toEqual(["github"]);
    }
    const qa = services.find((s) => s.name === "chameleon-qa")!;
    expect(qa.identities.map((i) => i.provider)).toEqual(["bitbucket"]);
    expect(services).toHaveLength(5);

    const people = getPeople(h.db);
    const alice = people.find((p) => p.displayName === "Alice Smith")!;
    expect(alice.identities.map((i) => i.provider).sort()).toEqual(["bitbucket", "github"]);
    const newbie = people.find((p) => p.displayName === "newbie")!;
    expect(newbie.included).toBe(false);
    expect(people).toHaveLength(3);
  });

  it("is idempotent: a re-run changes nothing", async () => {
    await call();
    const after = snapshot();
    const res = await call();
    expect(res.status).toBe(200);
    expect(snapshot()).toBe(after);
  });

  it("never alters an include flag, including one ticked after the first run", async () => {
    await call();
    const flags = () => JSON.stringify([
      getServices(h.db).map((s) => [s.name, s.included]),
      getPeople(h.db).map((p) => [p.displayName, p.included]),
    ]);
    const before = flags();
    // The user ticks a newly-discovered GitHub-only service, then re-runs Discover.
    const fresh = getServices(h.db).find((s) => s.name === "benchmarkme")!;
    setServiceIncluded(h.db, fresh.id, true);
    await call();
    const flagsAfter = JSON.parse(flags()) as [string, boolean][][];
    expect(flagsAfter[0].find(([n]) => n === "benchmarkme")![1]).toBe(true);
    expect(flagsAfter[0].find(([n]) => n === "chameleon-gateway")![1]).toBe(true);
    expect(flagsAfter[1].find(([n]) => n === "Alice Smith")![1]).toBe(true);
    expect(JSON.parse(before)[0].find(([n]: string[]) => n === "benchmarkme")[1]).toBe(false);
  });
});
