// src/lib/db/canonical.test.ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "@/lib/db/schema";
import {
  getPeople, getServices, setPersonIncluded, setServiceIncluded,
  upsertPersonIdentity, upsertServiceIdentity, linkServiceIdentity,
  setServiceIdentityState, getLastRefreshedByProvider,
} from "@/lib/db/canonical";

const freshDb = () => { const db = new Database(":memory:"); applySchema(db); return db; };

describe("canonical queries", () => {
  it("creates a person on first sight and returns the same id on re-upsert", () => {
    const db = freshDb();
    const a = upsertPersonIdentity(db, "github", "alice", "Alice");
    const b = upsertPersonIdentity(db, "github", "alice", "Alice Renamed");
    expect(b).toBe(a);
    const people = getPeople(db);
    expect(people).toHaveLength(1);
    expect(people[0].displayName).toBe("Alice Renamed");
    db.close();
  });

  it("creates new people and services excluded by default", () => {
    const db = freshDb();
    upsertPersonIdentity(db, "github", "alice", "Alice");
    upsertServiceIdentity(db, "github", "repo-a", "Repo A", "main", null);
    expect(getPeople(db)[0].included).toBe(false);
    expect(getServices(db)[0].included).toBe(false);
    db.close();
  });

  it("sorts people case-insensitively", () => {
    const db = freshDb();
    upsertPersonIdentity(db, "github", "c", "carolyn");
    upsertPersonIdentity(db, "github", "a", "Adam");
    upsertPersonIdentity(db, "github", "b", "Bob");
    expect(getPeople(db).map((p) => p.displayName)).toEqual(["Adam", "Bob", "carolyn"]);
    db.close();
  });

  it("carries one include flag across every identity of a service", () => {
    const db = freshDb();
    const svc = upsertServiceIdentity(db, "bitbucket", "repo-a", "Repo A", "main", null);
    upsertServiceIdentity(db, "github", "repo-a", "Repo A", "main", null);
    linkServiceIdentity(db, "github", "repo-a", svc);
    setServiceIncluded(db, svc, true);

    const services = getServices(db);
    expect(services).toHaveLength(1);
    expect(services[0].included).toBe(true);
    expect(services[0].identities.map((i) => i.provider).sort()).toEqual(["bitbucket", "github"]);
    db.close();
  });

  it("merges a service's rows into the target and leaves no orphan behind", () => {
    const db = freshDb();
    const keep = upsertServiceIdentity(db, "bitbucket", "benchmarkmeapp", "benchmarkmeapp", "main", null);
    upsertServiceIdentity(db, "github", "benchmarkme", "benchmarkme", "main", null);
    expect(getServices(db)).toHaveLength(2);

    linkServiceIdentity(db, "github", "benchmarkme", keep);
    const services = getServices(db);
    expect(services).toHaveLength(1);
    expect(services[0].identities).toHaveLength(2);
    db.close();
  });

  it("reports freshness per provider, flagging archived ones", () => {
    const db = freshDb();
    const bb = upsertServiceIdentity(db, "bitbucket", "repo-a", "Repo A", "main", null);
    setServiceIncluded(db, bb, true);
    setServiceIdentityState(db, "bitbucket", "repo-a", "archived");
    db.prepare(`UPDATE service_identities SET last_synced_on = ? WHERE provider='bitbucket'`)
      .run("2026-09-28T13:00:00.000Z");

    const gh = upsertServiceIdentity(db, "github", "repo-b", "Repo B", "main", null);
    setServiceIncluded(db, gh, true);
    db.prepare(`UPDATE service_identities SET last_synced_on = ? WHERE provider='github'`)
      .run("2026-10-07T14:02:00.000Z");

    expect(getLastRefreshedByProvider(db)).toEqual([
      { provider: "bitbucket", lastSyncedOn: "2026-09-28T13:00:00.000Z", archived: true },
      { provider: "github", lastSyncedOn: "2026-10-07T14:02:00.000Z", archived: false },
    ]);
    db.close();
  });

  it("omits a provider that has never synced", () => {
    const db = freshDb();
    const gh = upsertServiceIdentity(db, "github", "repo-b", "Repo B", "main", null);
    setServiceIncluded(db, gh, true);
    expect(getLastRefreshedByProvider(db)).toEqual([]);
    db.close();
  });

  it("ignores excluded services when reporting freshness", () => {
    const db = freshDb();
    upsertServiceIdentity(db, "github", "repo-b", "Repo B", "main", null);
    db.prepare(`UPDATE service_identities SET last_synced_on = ?`).run("2026-10-07T14:02:00.000Z");
    expect(getLastRefreshedByProvider(db)).toEqual([]);
    db.close();
  });
});
