// src/lib/db/migrations/runner.ts
import type Database from "better-sqlite3";

export type Migration = {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
};

// Writes a verified copy of the database somewhere safe. Injected so tests can
// assert it was called, and so an in-memory database can skip it.
export type Snapshot = (label: string) => void;

// Tables whose row counts are irreplaceable. A migration that changes either count
// has lost history, and loses the whole run rather than the rows.
const GUARDED = ["pull_requests", "approvals"] as const;

const tableExists = (db: Database.Database, name: string): boolean =>
  db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`).get(name) !== undefined;

const guardedCounts = (db: Database.Database): Record<string, number> =>
  Object.fromEntries(
    GUARDED.filter((t) => tableExists(db, t)).map((t) => [
      t,
      (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c,
    ]),
  );

export const runMigrations = (
  db: Database.Database,
  migrations: Migration[],
  snapshot?: Snapshot,
): void => {
  const current = db.pragma("user_version", { simple: true }) as number;
  const latest = migrations.reduce((max, m) => Math.max(max, m.version), 0);

  // A database written by newer code may use columns this build cannot read.
  // Refusing is the only safe response: "rebuilding" would discard real history.
  if (current > latest) {
    throw new Error(
      `Database is at schema version ${current}, but this build only understands up to ${latest}. ` +
      `It was written by a newer version of Argus. Upgrade rather than downgrade — ` +
      `no attempt will be made to rewrite it.`,
    );
  }

  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  if (pending.length === 0) return;

  snapshot?.(`v${current}-to-v${latest}`);
  const before = guardedCounts(db);

  for (const migration of pending) {
    const apply = db.transaction(() => {
      migration.up(db);
      // Interpolated, not bound: SQLite does not accept parameters in PRAGMA.
      // The value is a number from our own code, never user input.
      db.pragma(`user_version = ${migration.version}`);

      const after = guardedCounts(db);
      for (const [table, count] of Object.entries(before)) {
        if (after[table] !== count) {
          throw new Error(
            `Migration ${migration.version} (${migration.name}) changed the ${table} row count ` +
            `from ${count} to ${after[table]}. Rolling back — cached history is irreplaceable.`,
          );
        }
      }
    });
    apply();
  }
};
