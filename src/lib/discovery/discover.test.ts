// Failure scenario: if this is wrong, a user sees two different services' histories
// fused into one, chosen by whichever order GitHub happened to return them in.
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "@/lib/db/schema";
import { upsertServiceIdentity, upsertPersonIdentity, getServices, getPeople, linkServiceIdentity } from "@/lib/db/canonical";
import { discoverProvider } from "@/lib/discovery/discover";
import type { PullRequestProvider } from "@/lib/providers/types";

const fake = (
  repoNames: string[], people: string[] = [],
): PullRequestProvider => ({
  id: "github", label: "GitHub",
  capabilities: { mergeTimestamps: "exact", readyForReviewTimestamps: "onDemand", approvalTimestamps: "onDemand" },
  listRepositories: async () => repoNames.map((n) => ({ repoKey: n, name: n, defaultBranch: "main", groupKey: null })),
  listPeople: async () => people.map((n) => ({ accountId: n, displayName: n })),
  listPullRequests: async () => [],
});

const freshDb = () => { const db = new Database(":memory:"); applySchema(db); return db; };

describe("discoverProvider batch ambiguity", () => {
  for (const order of [["foo-bar", "foo_bar"], ["foo_bar", "foo-bar"]]) {
    it(`links neither of two alike-named repos (order ${order.join(", ")})`, async () => {
      const db = freshDb();
      upsertServiceIdentity(db, "bitbucket", "foobar", "foobar", "main", null);
      await discoverProvider(db, fake(order));
      const services = getServices(db);
      expect(services).toHaveLength(3);
      expect(services.find((s) => s.name === "foobar")!.identities.map((i) => i.provider)).toEqual(["bitbucket"]);
      for (const n of order) {
        const s = services.find((x) => x.name === n)!;
        expect(s.included).toBe(false);
        expect(s.identities).toHaveLength(1);
      }
    });
  }

  it("links neither of two alike-named people", async () => {
    const db = freshDb();
    upsertPersonIdentity(db, "bitbucket", "bb1", "johnsmith");
    await discoverProvider(db, fake([], ["john.smith", "john_smith"]));
    const people = getPeople(db);
    expect(people).toHaveLength(3);
    expect(people.find((p) => p.displayName === "johnsmith")!.identities).toHaveLength(1);
  });

  it("does not restore a link the user moved by hand", async () => {
    const db = freshDb();
    const gw = upsertServiceIdentity(db, "bitbucket", "gw", "gw", "main", null);
    const other = upsertServiceIdentity(db, "bitbucket", "other", "other", "main", null);
    await discoverProvider(db, fake(["gw"]));
    linkServiceIdentity(db, "github", "gw", other);
    await discoverProvider(db, fake(["gw"]));
    const services = getServices(db);
    expect(services.find((s) => s.id === other)!.identities).toHaveLength(2);
    expect(services.find((s) => s.id === gw)!.identities).toHaveLength(1);
  });
});
