import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "@/config";
import { applySchema } from "./schema";

let instance: Database.Database | null = null;

// Returns a process-wide singleton DB handle with the schema applied.
export const getDb = (): Database.Database => {
  if (instance) return instance;
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applySchema(db);
  instance = db;
  return instance;
};
