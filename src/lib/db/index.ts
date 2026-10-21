// src/lib/db/index.ts
// Opens the SQLite cache and brings it to the current schema. Because the cache may hold
// history that cannot be re-fetched, a verified snapshot is taken before any migration runs.
import Database from "better-sqlite3";
import { mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { config } from "@/config";
import { runMigrations, type Migration } from "./migrations/runner";
import { MIGRATIONS } from "./migrations";

let instance: Database.Database | null = null;

// Pending-version labels already snapshotted (and verified) by this process. A failed
// migration leaves the file at the same version, so every later request would otherwise
// write another full-size snapshot: one verified snapshot per pending version is the
// guarantee, not one per request. Recorded only after verification succeeds, so a failed
// snapshot is retried and a migration still never runs without one.
const snapshotted = new Set<string>();

// A verified copy beside the cache, taken only when a migration is actually pending.
// Throws if it cannot be written or read back: a migration must never run unbacked.
const snapshotTo = (dbPath: string, done: Set<string>) => (label: string): void => {
  const key = `${dbPath}:${label}`;
  if (done.has(key)) return;
  const out = join(dirname(dbPath), `${basename(dbPath, ".sqlite")}.pre-${label}-${Date.now()}.sqlite`);
  const source = new Database(dbPath, { readonly: true });
  try {
    source.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  } finally {
    source.close();
  }
  if (!existsSync(out) || statSync(out).size === 0) {
    throw new Error(`Refusing to migrate: could not write a verified snapshot to ${out}`);
  }
  const check = new Database(out, { readonly: true });
  try {
    if (check.pragma("integrity_check", { simple: true }) !== "ok") {
      throw new Error(`Refusing to migrate: snapshot at ${out} failed its integrity check`);
    }
  } finally {
    check.close();
  }
  done.add(key);
  console.log(`[argus] pre-migration snapshot written to ${out}`);
};

// Opens `dbPath` and brings it to the latest schema. If that fails the handle is closed
// before the error propagates, so a failed migration does not leak a connection per request.
export const openDatabase = (
  dbPath: string,
  migrations: Migration[] = MIGRATIONS,
  done: Set<string> = snapshotted,
): Database.Database => {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    // An in-memory database has nothing to snapshot and nothing to lose.
    runMigrations(db, migrations, dbPath === ":memory:" ? undefined : snapshotTo(dbPath, done));
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
};

// Returns a process-wide singleton DB handle with the schema applied.
export const getDb = (): Database.Database => {
  if (!instance) instance = openDatabase(config.dbPath);
  return instance;
};
