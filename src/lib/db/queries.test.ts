import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "@/lib/db/schema";

const freshDb = () => {
  const db = new Database(":memory:");
  applySchema(db);
  return db;
};

describe("applySchema", () => {
  it("creates all five tables", () => {
    const db = freshDb();
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toEqual(["approvals", "pull_requests", "repos", "sync_state", "users"]);
    db.close();
  });
});
