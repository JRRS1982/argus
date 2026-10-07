// Drives the real GET/PATCH /api/roster against an in-memory database. Failure scenario:
// if this is wrong, a user cannot tick a GitHub-only repository, so GitHub never syncs;
// or a merge cannot be undone; or an archived Bitbucket history is made removable.
import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { applySchema } from "@/lib/db/schema";
import { upsertBitbucketRepos, upsertBitbucketUsers } from "@/lib/db/queries";
import {
  getPeople, getServices, getSyncableIdentities, upsertServiceIdentity, upsertPersonIdentity,
  setServiceIdentityState,
} from "@/lib/db/canonical";
import { syncAll } from "@/lib/sync/sync";
import type { PullRequestProvider } from "@/lib/providers/types";

const h = vi.hoisted(() => ({
  db: null as unknown as import("better-sqlite3").Database,
  cfg: { workspace: "ws", projectKey: null, dbPath: ":memory:", githubToken: "tok" as string | null, githubOrg: "org" },
  bitbucketCreds: true,
}));
vi.mock("@/lib/db", () => ({ getDb: () => h.db }));
vi.mock("@/config", () => ({ config: h.cfg, hasBitbucketCredentials: () => h.bitbucketCreds, isDemoAvailable: () => true }));

import { GET, PATCH } from "@/app/api/roster/route";

const get = (qs = "") => GET(new NextRequest(`http://localhost/api/roster${qs}`));
const patch = (body: unknown, qs = "") => PATCH(new NextRequest(`http://localhost/api/roster${qs}`, {
  method: "PATCH", body: JSON.stringify(body),
}));

beforeEach(() => {
  h.db = new Database(":memory:");
  applySchema(h.db);
  h.cfg.githubToken = "tok";
  h.bitbucketCreds = true;
});

describe("/api/roster over canonical entities", () => {
  it("lists a GitHub-only service, which the legacy tables never held", async () => {
    upsertServiceIdentity(h.db, "github", "gh-only", "gh-only", "main", null);
    const body = await (await get()).json();
    expect(body.services.map((s: { name: string }) => s.name)).toEqual(["gh-only"]);
    expect(body.services[0].identities[0]).toMatchObject({ provider: "github", state: "active" });
  });

  it("a GitHub-only service can be ticked and then syncs", async () => {
    const id = upsertServiceIdentity(h.db, "github", "gh-only", "gh-only", "main", null);
    expect(getSyncableIdentities(h.db)).toEqual([]); // new arrivals are excluded

    const res = await patch({ kind: "service", id, included: true });
    expect(res.status).toBe(200);
    expect(getServices(h.db)[0].included).toBe(true);

    const syncable = getSyncableIdentities(h.db);
    expect(syncable.map((i) => [i.provider, i.repoKey])).toEqual([["github", "gh-only"]]);

    const listPullRequests = vi.fn().mockResolvedValue([]);
    const github = {
      id: "github", label: "GitHub",
      capabilities: { mergeTimestamps: "exact", readyForReviewTimestamps: "onDemand", approvalTimestamps: "onDemand" },
      listPeople: vi.fn(), listRepositories: vi.fn(), listPullRequests,
    } as unknown as PullRequestProvider;
    const result = await syncAll({ db: h.db, providers: { github } }, syncable, "2026-10-07T00:00:00.000Z");
    expect(listPullRequests).toHaveBeenCalledTimes(1);
    expect(result.repos).toEqual([{ provider: "github", repoKey: "gh-only", prCount: 0 }]);
  });

  it("ticks and unticks a person by canonical id", async () => {
    const id = upsertPersonIdentity(h.db, "github", "newbie", "newbie");
    await patch({ kind: "person", id, included: true });
    expect(getPeople(h.db)[0].included).toBe(true);
    await patch({ kind: "person", id, included: false });
    expect(getPeople(h.db)[0].included).toBe(false);
  });

  it("rejects the old account-id/slug keying", async () => {
    expect((await patch({ kind: "repo", id: "slug", included: true })).status).toBe(400);
    expect((await patch({ kind: "service", id: "1", included: true })).status).toBe(400);
  });

  it("refuses writes in demo mode", async () => {
    expect((await patch({ kind: "service", id: 1, included: true }, "?demo=1")).status).toBe(400);
  });

  it("merges an identity into another service and splits it back out", async () => {
    upsertBitbucketRepos(h.db, [{ slug: "benchmarkme", name: "benchmarkme", projectKey: null, mainBranch: "main" }]);
    upsertServiceIdentity(h.db, "github", "benchmarkmeapp", "benchmarkmeapp", "main", null);
    const target = getServices(h.db).find((s) => s.name === "benchmarkme")!;

    await patch({ kind: "service", action: "merge", provider: "github", key: "benchmarkmeapp", intoId: target.id });
    let services = getServices(h.db);
    expect(services).toHaveLength(1);
    expect(services[0].identities.map((i) => i.provider).sort()).toEqual(["bitbucket", "github"]);

    await patch({ kind: "service", action: "split", provider: "github", key: "benchmarkmeapp" });
    services = getServices(h.db);
    expect(services.map((s) => [s.name, s.included, s.identities.length]).sort())
      .toEqual([["benchmarkme", false, 1], ["benchmarkmeapp", false, 1]].sort());
    // A second split of a lone identity must not mint another entity.
    await patch({ kind: "service", action: "split", provider: "github", key: "benchmarkmeapp" });
    expect(getServices(h.db)).toHaveLength(2);
  });

  it("merges and splits people", async () => {
    upsertBitbucketUsers(h.db, [{ accountId: "bb1", displayName: "Alice Smith" }]);
    upsertPersonIdentity(h.db, "github", "asmith", "asmith");
    const alice = getPeople(h.db).find((p) => p.displayName === "Alice Smith")!;
    await patch({ kind: "person", action: "merge", provider: "github", key: "asmith", intoId: alice.id });
    expect(getPeople(h.db)).toHaveLength(1);
    await patch({ kind: "person", action: "split", provider: "github", key: "asmith" });
    expect(getPeople(h.db)).toHaveLength(2);
  });

  it("refuses with 400 to split a person holding two identities on one provider", async () => {
    upsertBitbucketUsers(h.db, [{ accountId: "bb1", displayName: "Alice Smith" }]);
    upsertPersonIdentity(h.db, "bitbucket", "raw-id", "raw-id");
    const alice = getPeople(h.db).find((p) => p.displayName === "Alice Smith")!;
    await patch({ kind: "person", action: "merge", provider: "bitbucket", key: "raw-id", intoId: alice.id });

    const res = await patch({ kind: "person", action: "split", provider: "bitbucket", key: "raw-id" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/more than one bitbucket identity/i);
    expect(getPeople(h.db)).toHaveLength(1);
  });

  it("reports a ticked service whose active identity's provider has no credentials", async () => {
    const id = upsertServiceIdentity(h.db, "github", "gh-only", "gh-only", "main", null);
    await patch({ kind: "service", id, included: true });
    h.cfg.githubToken = null;
    expect((await (await get()).json()).unconfiguredProviders).toEqual(["github"]);
    h.cfg.githubToken = "tok";
    expect((await (await get()).json()).unconfiguredProviders).toEqual([]);
  });

  it("does not flag Bitbucket when its identities are archived", async () => {
    const id = upsertServiceIdentity(h.db, "bitbucket", "old", "old", "main", null);
    setServiceIdentityState(h.db, "bitbucket", "old", "archived");
    await patch({ kind: "service", id, included: true });
    h.bitbucketCreds = false;
    expect((await (await get()).json()).unconfiguredProviders).toEqual([]);
  });

  it("serves the demo dataset in the same canonical shape", async () => {
    const body = await (await get("?demo=1")).json();
    expect(body.people.length).toBeGreaterThan(0);
    expect(body.services[0]).toHaveProperty("identities");
  });
});
