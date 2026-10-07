// src/lib/db/schema.ts — replaces the CREATE TABLE IF NOT EXISTS block
import type Database from "better-sqlite3";
import { runMigrations, type Snapshot } from "./migrations/runner";
import { MIGRATIONS } from "./migrations";

// Creates a fresh database or upgrades an existing one. There is no CREATE TABLE here
// any more: migration 001 and 002 define the schema, so a brand-new file and a
// decade-old cache converge on exactly the same shape by the same code path.
export const applySchema = (db: Database.Database, snapshot?: Snapshot): void => {
  runMigrations(db, MIGRATIONS, snapshot);
};
