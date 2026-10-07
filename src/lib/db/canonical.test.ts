// src/lib/db/canonical.test.ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "@/lib/db/schema";
import {
  getPeople, getServices, setPersonIncluded, setServiceIncluded,
  upsertPersonIdentity, upsertServiceIdentity, linkServiceIdentity, linkPersonIdentity,
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

    // Positive control: a synced included service does appear.
    const bb = upsertServiceIdentity(db, "bitbucket", "repo-a", "Repo A", "main", null);
    setServiceIncluded(db, bb, true);
    db.prepare(`UPDATE service_identities SET last_synced_on = ? WHERE provider='bitbucket'`)
      .run("2026-09-28T13:00:00.000Z");
    expect(getLastRefreshedByProvider(db).map((r) => r.provider)).toEqual(["bitbucket"]);
    db.close();
  });

  it("ignores excluded services when reporting freshness", () => {
    const db = freshDb();
    upsertServiceIdentity(db, "github", "repo-b", "Repo B", "main", null);
    db.prepare(`UPDATE service_identities SET last_synced_on = ?`).run("2026-10-07T14:02:00.000Z");
    expect(getLastRefreshedByProvider(db)).toEqual([]);

    // Positive control: ticking it makes the same row appear.
    setServiceIncluded(db, getServices(db)[0].id, true);
    expect(getLastRefreshedByProvider(db)).toHaveLength(1);
    db.close();
  });
});

const seedPr = (db: Database.Database, provider: string, repoKey: string, n: number, serviceId: number, personId: number) =>
  db.prepare(`
    INSERT INTO pull_requests (provider, repo_key, number, service_id, person_id, title, state,
      created_on, ready_for_review_on, ready_for_review_precision, destination_branch, url)
    VALUES (?, ?, ?, ?, ?, 't', 'MERGED', '2026-01-01', '2026-01-01', 'exact', 'main', 'u')
  `).run(provider, repoKey, n, serviceId, personId);
const seedApproval = (db: Database.Database, provider: string, repoKey: string, n: number, approver: string, personId: number) =>
  db.prepare(`
    INSERT INTO approvals (provider, repo_key, pr_number, approver_account_id, person_id, approved_on)
    VALUES (?, ?, ?, ?, ?, '2026-01-02')
  `).run(provider, repoKey, n, approver, personId);
const col = (db: Database.Database, sql: string) => (db.prepare(sql).all() as { v: number }[]).map((r) => r.v);

describe("identity linking moves only the linked identity's rows", () => {
  it("services: re-points only the moved repo's pull requests", () => {
    const db = freshDb();
    const s = upsertServiceIdentity(db, "bitbucket", "A", "A", "main", null);
    upsertServiceIdentity(db, "github", "B", "B", "main", null);
    const t = upsertServiceIdentity(db, "github", "T", "T", "main", null);
    linkServiceIdentity(db, "github", "B", s); // S now holds A and B
    const p = upsertPersonIdentity(db, "github", "alice", "Alice");
    seedPr(db, "bitbucket", "A", 1, s, p);
    seedPr(db, "github", "B", 1, s, p);

    linkServiceIdentity(db, "github", "B", t);

    expect(col(db, `SELECT service_id AS v FROM pull_requests WHERE repo_key='A'`)).toEqual([s]);
    expect(col(db, `SELECT service_id AS v FROM pull_requests WHERE repo_key='B'`)).toEqual([t]);
    expect(getServices(db).map((x) => x.id).sort()).toEqual([s, t].sort());
    db.close();
  });

  it("people: re-points only the moved identity's pull requests and approvals", () => {
    const db = freshDb();
    const svc = upsertServiceIdentity(db, "github", "R", "R", "main", null);
    const keep = upsertPersonIdentity(db, "bitbucket", "bb-alice", "Alice");
    upsertPersonIdentity(db, "github", "gh-alice", "alice");
    const target = upsertPersonIdentity(db, "github", "other", "Other");
    linkPersonIdentity(db, "github", "gh-alice", keep); // keep holds bb + gh
    seedPr(db, "bitbucket", "R", 1, svc, keep);
    seedPr(db, "github", "R", 2, svc, keep);
    seedApproval(db, "bitbucket", "R", 1, "bb-alice", keep);
    seedApproval(db, "github", "R", 2, "gh-alice", keep);

    linkPersonIdentity(db, "github", "gh-alice", target);

    expect(col(db, `SELECT person_id AS v FROM pull_requests WHERE provider='bitbucket'`)).toEqual([keep]);
    expect(col(db, `SELECT person_id AS v FROM pull_requests WHERE provider='github'`)).toEqual([target]);
    expect(col(db, `SELECT person_id AS v FROM approvals WHERE provider='bitbucket'`)).toEqual([keep]);
    expect(col(db, `SELECT person_id AS v FROM approvals WHERE provider='github'`)).toEqual([target]);
    db.close();
  });
});

describe("linkPersonIdentity", () => {
  it("merges a person, re-pointing rows and deleting the emptied person", () => {
    const db = freshDb();
    const svc = upsertServiceIdentity(db, "github", "R", "R", "main", null);
    const keep = upsertPersonIdentity(db, "bitbucket", "bb", "Alice");
    const gone = upsertPersonIdentity(db, "github", "gh", "alice-gh");
    seedPr(db, "github", "R", 1, svc, gone);
    seedApproval(db, "github", "R", 1, "gh", gone);

    linkPersonIdentity(db, "github", "gh", keep);

    const people = getPeople(db);
    expect(people).toHaveLength(1);
    expect(people[0].identities).toHaveLength(2);
    expect(col(db, `SELECT person_id AS v FROM pull_requests`)).toEqual([keep]);
    expect(col(db, `SELECT person_id AS v FROM approvals`)).toEqual([keep]);
    db.close();
  });

  it("does nothing for an unknown identity", () => {
    const db = freshDb();
    const keep = upsertPersonIdentity(db, "github", "a", "A");
    linkPersonIdentity(db, "github", "nobody", keep);
    expect(getPeople(db)).toHaveLength(1);
    expect(getPeople(db)[0].identities).toHaveLength(1);
    db.close();
  });

  it("does nothing when the identity is already on the target", () => {
    const db = freshDb();
    const a = upsertPersonIdentity(db, "github", "a", "A");
    linkPersonIdentity(db, "github", "a", a);
    expect(getPeople(db)).toHaveLength(1);
    expect(getPeople(db)[0].identities).toHaveLength(1);
    db.close();
  });

  it("keeps the old person when it still has another identity", () => {
    const db = freshDb();
    const old = upsertPersonIdentity(db, "bitbucket", "bb", "Alice");
    upsertPersonIdentity(db, "github", "gh", "Alice");
    linkPersonIdentity(db, "github", "gh", old);
    const target = upsertPersonIdentity(db, "github", "other", "Other");
    linkPersonIdentity(db, "github", "gh", target);
    const ids = getPeople(db).map((p) => p.id).sort();
    expect(ids).toEqual([old, target].sort());
    db.close();
  });

  it("leaves a hand-merged identity on its merged person when re-upserted", () => {
    const db = freshDb();
    const keep = upsertPersonIdentity(db, "bitbucket", "bb", "Alice");
    upsertPersonIdentity(db, "github", "gh", "alice-gh");
    linkPersonIdentity(db, "github", "gh", keep);
    expect(upsertPersonIdentity(db, "github", "gh", "alice-gh")).toBe(keep);
    expect(getPeople(db)).toHaveLength(1);
    db.close();
  });

  it("keeps a merged person's name stable across re-upserts", () => {
    const db = freshDb();
    const keep = upsertPersonIdentity(db, "bitbucket", "bb", "Alice Smith");
    upsertPersonIdentity(db, "github", "gh", "asmith");
    linkPersonIdentity(db, "github", "gh", keep);
    upsertPersonIdentity(db, "github", "gh", "asmith");
    expect(getPeople(db)[0].displayName).toBe("Alice Smith");
    db.close();
  });
});
