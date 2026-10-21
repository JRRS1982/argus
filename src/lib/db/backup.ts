// src/lib/db/backup.ts
// The cache holds the only copy of the Bitbucket history: 7,603 pull requests reaching
// back to 2016, from a provider that is no longer fetchable. A backup of it is not a
// convenience, so this does not just copy the file.
//
// Two things a plain `cp` gets wrong:
//   - WAL. Recent writes live in `<db>-wal` until a checkpoint, so copying the .sqlite
//     file alone can silently produce a database missing everything written since the
//     last checkpoint. VACUUM INTO reads through the WAL and writes one consistent file.
//   - Verification. A copy that was never opened is a copy nobody knows is readable.
//     This reopens it, integrity-checks it, and compares every table's row count and the
//     schema version against the source before calling it a backup.
import Database from "better-sqlite3";
import { existsSync, statSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type BackupReport = {
  path: string;
  bytes: number;
  schemaVersion: number;
  counts: Record<string, number>;
};

// Every user table, rather than a named list: a table added later is then verified
// without anyone remembering to add it here.
const rowCounts = (db: Database.Database): Record<string, number> => {
  const tables = (db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  ).all() as { name: string }[]).map((r) => r.name);
  return Object.fromEntries(tables.map((t) => [
    t, (db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number }).c,
  ]));
};

const differences = (
  before: Record<string, number>, after: Record<string, number>,
): string[] => {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names]
    .filter((t) => before[t] !== after[t])
    .map((t) => `${t}: ${before[t] ?? "absent"} in the source, ${after[t] ?? "absent"} in the copy`);
};

export const backupDatabase = (sourcePath: string, outPath: string): BackupReport => {
  if (!existsSync(sourcePath)) {
    throw new Error(`No database to back up at ${sourcePath}.`);
  }
  // Never overwrite: a backup that silently replaces an older good one is a way to lose
  // both. Each run writes its own timestamped file.
  if (existsSync(outPath)) {
    throw new Error(`Refusing to overwrite an existing backup at ${outPath}.`);
  }
  mkdirSync(dirname(outPath), { recursive: true });

  const source = new Database(sourcePath, { readonly: true });
  let expected: Record<string, number>;
  let schemaVersion: number;
  try {
    expected = rowCounts(source);
    schemaVersion = source.pragma("user_version", { simple: true }) as number;
    source.exec(`VACUUM INTO '${outPath.replace(/'/g, "''")}'`);
  } finally {
    source.close();
  }

  if (!existsSync(outPath) || statSync(outPath).size === 0) {
    throw new Error(`Backup was not written, or was written empty, to ${outPath}.`);
  }

  const copy = new Database(outPath, { readonly: true });
  try {
    if (copy.pragma("integrity_check", { simple: true }) !== "ok") {
      throw new Error(`Backup at ${outPath} failed its integrity check.`);
    }
    const actualVersion = copy.pragma("user_version", { simple: true }) as number;
    if (actualVersion !== schemaVersion) {
      throw new Error(
        `Backup at ${outPath} is schema version ${actualVersion}, but the source is ${schemaVersion}.`,
      );
    }
    const diffs = differences(expected, rowCounts(copy));
    if (diffs.length > 0) {
      throw new Error(`Backup at ${outPath} does not match the source — ${diffs.join("; ")}.`);
    }
  } finally {
    copy.close();
  }

  return { path: outPath, bytes: statSync(outPath).size, schemaVersion, counts: expected };
};

// Sortable, filename-safe, and to the second so two runs in one minute cannot collide.
export const backupFilename = (now: Date): string => {
  const [date, time] = now.toISOString().slice(0, 19).split("T");
  return `argus-${date}-${time.replace(/:/g, "")}.sqlite`;
};
