// src/lib/db/index.ts — add the snapshot, keep everything else
import Database from "better-sqlite3";
import { mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { config } from "@/config";
import { applySchema } from "./schema";

let instance: Database.Database | null = null;

// A verified copy beside the cache, taken only when a migration is actually pending.
// Throws if it cannot be written or read back: a migration must never run unbacked.
const snapshotTo = (dbPath: string) => (label: string): void => {
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
  console.log(`[argus] pre-migration snapshot written to ${out}`);
};

export const getDb = (): Database.Database => {
  if (instance) return instance;
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // An in-memory database has nothing to snapshot and nothing to lose.
  applySchema(db, config.dbPath === ":memory:" ? undefined : snapshotTo(config.dbPath));
  instance = db;
  return instance;
};
