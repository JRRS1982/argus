// src/lib/db/migrations/runner.test.ts
import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations, type Migration } from "@/lib/db/migrations/runner";

const seeded = () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE pull_requests (repo_slug TEXT, id INTEGER);
           CREATE TABLE approvals (repo_slug TEXT, pr_id INTEGER);
           INSERT INTO pull_requests VALUES ('a', 1), ('a', 2);
           INSERT INTO approvals VALUES ('a', 1);`);
  return db;
};

const addTable: Migration = {
  version: 1, name: "add-thing",
  up: (db) => db.exec(`CREATE TABLE thing (id INTEGER PRIMARY KEY)`),
};

describe("runMigrations", () => {
  it("applies pending migrations and records the version", () => {
    const db = seeded();
    runMigrations(db, [addTable]);
    expect(db.pragma("user_version", { simple: true })).toBe(1);
    expect(db.prepare("SELECT COUNT(*) c FROM thing").get()).toEqual({ c: 0 });
    db.close();
  });

  it("is idempotent — re-running applies nothing", () => {
    const db = seeded();
    const up = vi.fn(addTable.up);
    runMigrations(db, [{ ...addTable, up }]);
    runMigrations(db, [{ ...addTable, up }]);
    expect(up).toHaveBeenCalledTimes(1);
    db.close();
  });

  it("takes a snapshot before applying anything", () => {
    const db = seeded();
    const snapshot = vi.fn();
    runMigrations(db, [addTable], snapshot);
    expect(snapshot).toHaveBeenCalledOnce();
    db.close();
  });

  it("does not snapshot when there is nothing to apply", () => {
    const db = seeded();
    const snapshot = vi.fn();
    db.pragma("user_version = 1");
    runMigrations(db, [addTable], snapshot);
    expect(snapshot).not.toHaveBeenCalled();
    db.close();
  });

  // Review Focus 2: a failure must leave the database exactly as it was.
  it("rolls back completely when a migration throws", () => {
    const db = seeded();
    const boom: Migration = {
      version: 1, name: "boom",
      up: (dbh) => { dbh.exec(`CREATE TABLE half (x INTEGER)`); throw new Error("boom"); },
    };
    expect(() => runMigrations(db, [boom])).toThrow("boom");
    expect(db.pragma("user_version", { simple: true })).toBe(0);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.map((t) => t.name)).not.toContain("half");
    expect(db.prepare("SELECT COUNT(*) c FROM pull_requests").get()).toEqual({ c: 2 });
    db.close();
  });

  it("rolls back when a migration loses pull_request rows", () => {
    const db = seeded();
    const lossy: Migration = {
      version: 1, name: "lossy",
      up: (dbh) => dbh.exec(`DELETE FROM pull_requests WHERE id = 2`),
    };
    expect(() => runMigrations(db, [lossy])).toThrow(/row count/i);
    expect(db.prepare("SELECT COUNT(*) c FROM pull_requests").get()).toEqual({ c: 2 });
    expect(db.pragma("user_version", { simple: true })).toBe(0);
    db.close();
  });

  it("refuses to open a database newer than the code understands", () => {
    const db = seeded();
    db.pragma("user_version = 99");
    expect(() => runMigrations(db, [addTable])).toThrow(/newer version/i);
    db.close();
  });

  it("applies multiple pending migrations in version order", () => {
    const db = seeded();
    const order: number[] = [];
    runMigrations(db, [
      { version: 2, name: "b", up: () => { order.push(2); } },
      { version: 1, name: "a", up: () => { order.push(1); } },
    ]);
    expect(order).toEqual([1, 2]);
    expect(db.pragma("user_version", { simple: true })).toBe(2);
    db.close();
  });
});
