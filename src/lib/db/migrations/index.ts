// src/lib/db/migrations/index.ts
import type { Migration } from "./runner";
import migration001 from "./001-canonical-entities";
import migration002 from "./002-provider-keyed-prs";
import migration003 from "./003-pr-author-account";

// Order here is cosmetic — the runner sorts by version — but keeping it ascending
// makes the sequence readable.
export const MIGRATIONS: Migration[] = [migration001, migration002, migration003];

export { runMigrations, type Migration, type Snapshot } from "./runner";
