// Failure scenario: if this is wrong, one failed migration makes every later request
// re-open the cache and write another full-size snapshot into data/ without limit, while
// leaking a connection each time.
import { describe, it, expect, vi, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@/config", () => ({ config: { dbPath: ":memory:" } }));
import { openDatabase } from "@/lib/db";

const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const failing = [{ version: 1, name: "boom", up: () => { throw new Error("boom"); } }];

describe("openDatabase", () => {
  it("closes the handle and snapshots once per pending version when a migration fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "argus-db-"));
    dirs.push(dir);
    const path = join(dir, "argus.sqlite");
    const seed = new Database(path);
    seed.exec("CREATE TABLE t (x)");
    seed.close();
    const closeSpy = vi.spyOn(Database.prototype, "close");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const done = new Set<string>();
    for (let i = 0; i < 3; i++) expect(() => openDatabase(path, failing, done)).toThrow("boom");

    expect(readdirSync(dir).filter((f) => f.includes(".pre-"))).toHaveLength(1);
    // 3 handles opened by openDatabase, closed on failure (plus the snapshot's own short-lived ones).
    expect(closeSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(done.size).toBe(1);
  });
});
