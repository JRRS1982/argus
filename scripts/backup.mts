// scripts/backup.mts — `npm run backup`
// Writes a verified copy of the SQLite cache. Run it before anything that touches the
// database, and on whatever schedule suits: the cache holds the only copy of the
// Bitbucket history, which cannot be re-fetched from anywhere.
//
// Backups default to OUTSIDE the repository. `data/` is git-ignored, so `git clean -fdx`
// in this working tree would delete the cache and any backup kept beside it in one go.
import { homedir } from "node:os";
import { join } from "node:path";
import { backupDatabase, backupFilename } from "../src/lib/db/backup.ts";

const source = process.env.ARGUS_DB_PATH ?? "data/argus.sqlite";
const directory = process.env.ARGUS_BACKUP_DIR ?? join(homedir(), "argus-backups");

try {
  const report = backupDatabase(source, join(directory, backupFilename(new Date())));
  const mb = (report.bytes / 1024 / 1024).toFixed(1);
  console.log(`Verified backup of ${source} written to ${report.path} (${mb} MB, schema v${report.schemaVersion})`);
  for (const [table, count] of Object.entries(report.counts)) {
    console.log(`  ${table.padEnd(24)} ${String(count).padStart(7)}`);
  }
} catch (err) {
  console.error(`Backup failed: ${err instanceof Error ? err.message : String(err)}`);
  console.error("Nothing was changed. The database itself is untouched.");
  process.exit(1);
}
