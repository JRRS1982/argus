// src/lib/db/backup.test.ts
// Failure scenario: the backup reports success but holds an incomplete or corrupt copy,
// and the user finds out only when they reach for it — by which time the Bitbucket
// history it was protecting is already gone and cannot be re-fetched.
import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupDatabase, backupFilename } from "@/lib/db/backup";

const dirs: string[] = [];
const workspace = () => {
  const dir = mkdtempSync(join(tmpdir(), "argus-backup-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => { dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })); });

const seed = (path: string, prs: number) => {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE pull_requests (id INTEGER PRIMARY KEY, title TEXT NOT NULL)`);
  db.pragma("user_version = 2");
  const insert = db.prepare(`INSERT INTO pull_requests (id, title) VALUES (?, ?)`);
  db.transaction(() => { for (let i = 1; i <= prs; i += 1) insert.run(i, `PR ${i}`); })();
  return db;
};

describe("backupDatabase", () => {
  it("copies every row and the schema version", () => {
    const dir = workspace();
    const source = join(dir, "argus.sqlite");
    seed(source, 25).close();

    const report = backupDatabase(source, join(dir, "out", "copy.sqlite"));

    expect(report.counts).toEqual({ pull_requests: 25 });
    expect(report.schemaVersion).toBe(2);
    expect(statSync(report.path).size).toBeGreaterThan(0);
  });

  // The reason this does not shell out to `cp`. Writes sit in the -wal file until a
  // checkpoint, so a file copy taken with the database open loses them silently.
  it("includes writes still sitting in the write-ahead log", () => {
    const dir = workspace();
    const source = join(dir, "argus.sqlite");
    const db = seed(source, 10);
    db.prepare(`INSERT INTO pull_requests (id, title) VALUES (999, 'written after the checkpoint')`).run();

    const report = backupDatabase(source, join(dir, "copy.sqlite"));

    expect(report.counts.pull_requests).toBe(11);
    const copy = new Database(report.path, { readonly: true });
    expect(copy.prepare(`SELECT title FROM pull_requests WHERE id = 999`).get())
      .toEqual({ title: "written after the checkpoint" });
    copy.close();
    db.close();
  });

  it("refuses to overwrite a backup that already exists", () => {
    const dir = workspace();
    const source = join(dir, "argus.sqlite");
    seed(source, 1).close();
    const out = join(dir, "copy.sqlite");
    backupDatabase(source, out);

    expect(() => backupDatabase(source, out)).toThrow(/Refusing to overwrite/);
  });

  it("refuses when there is no database to back up", () => {
    const dir = workspace();
    expect(() => backupDatabase(join(dir, "absent.sqlite"), join(dir, "copy.sqlite")))
      .toThrow(/No database to back up/);
  });

  it("rejects a source that is not a readable database", () => {
    const dir = workspace();
    const source = join(dir, "argus.sqlite");
    writeFileSync(source, "this is not a database");

    expect(() => backupDatabase(source, join(dir, "copy.sqlite"))).toThrow();
  });
});

describe("backupFilename", () => {
  it("sorts chronologically and names the second it was taken", () => {
    expect(backupFilename(new Date("2026-10-21T14:43:53.512Z")))
      .toBe("argus-2026-10-21-144353.sqlite");
  });

  it("gives two backups in the same minute different names", () => {
    expect(backupFilename(new Date("2026-10-21T14:43:01Z")))
      .not.toBe(backupFilename(new Date("2026-10-21T14:43:02Z")));
  });
});
