// src/lib/db/canonical.ts
import type Database from "better-sqlite3";
import type {
  Person, Service, ProviderId, IdentityState, PersonIdentity, ServiceIdentity,
} from "@/types";

type PersonRow = { id: number; display_name: string; included: number };
type PersonIdentityRow = { person_id: number; provider: string; account_id: string };

export const getPeople = (db: Database.Database): Person[] => {
  // COLLATE NOCASE: SQLite's default sorts every capital before every lowercase,
  // scattering names like "carolyn.symonds" below every capitalised one.
  const rows = db.prepare(
    `SELECT id, display_name, included FROM people ORDER BY display_name COLLATE NOCASE`,
  ).all() as PersonRow[];
  const identities = db.prepare(
    `SELECT person_id, provider, account_id FROM person_identities`,
  ).all() as PersonIdentityRow[];

  const byPerson = new Map<number, PersonIdentity[]>();
  for (const i of identities) {
    const list = byPerson.get(i.person_id) ?? [];
    list.push({ provider: i.provider as ProviderId, accountId: i.account_id });
    byPerson.set(i.person_id, list);
  }
  return rows.map((r) => ({
    id: r.id, displayName: r.display_name, included: !!r.included,
    identities: byPerson.get(r.id) ?? [],
  }));
};

type ServiceRow = { id: number; name: string; included: number };
type ServiceIdentityRow = {
  service_id: number; provider: string; repo_key: string; default_branch: string;
  group_key: string | null; state: string; last_synced_on: string | null;
};

export const getServices = (db: Database.Database): Service[] => {
  const rows = db.prepare(
    `SELECT id, name, included FROM services ORDER BY name COLLATE NOCASE`,
  ).all() as ServiceRow[];
  const identities = db.prepare(
    `SELECT service_id, provider, repo_key, default_branch, group_key, state, last_synced_on
     FROM service_identities`,
  ).all() as ServiceIdentityRow[];

  const byService = new Map<number, ServiceIdentity[]>();
  for (const i of identities) {
    const list = byService.get(i.service_id) ?? [];
    list.push({
      provider: i.provider as ProviderId, repoKey: i.repo_key,
      defaultBranch: i.default_branch, groupKey: i.group_key,
      state: i.state as IdentityState, lastSyncedOn: i.last_synced_on,
    });
    byService.set(i.service_id, list);
  }
  return rows.map((r) => ({
    id: r.id, name: r.name, included: !!r.included,
    identities: byService.get(r.id) ?? [],
  }));
};

export const setPersonIncluded = (db: Database.Database, personId: number, included: boolean): void => {
  db.prepare(`UPDATE people SET included = ? WHERE id = ?`).run(included ? 1 : 0, personId);
};

export const setServiceIncluded = (db: Database.Database, serviceId: number, included: boolean): void => {
  db.prepare(`UPDATE services SET included = ? WHERE id = ?`).run(included ? 1 : 0, serviceId);
};

// Returns the canonical person id for this identity, creating one if the identity is
// new. A known identity keeps its person — re-running Discover must never re-home
// someone whose identities were merged by hand.
export const upsertPersonIdentity = (
  db: Database.Database, provider: ProviderId, accountId: string, displayName: string,
): number => {
  const existing = db.prepare(
    `SELECT person_id FROM person_identities WHERE provider = ? AND account_id = ?`,
  ).get(provider, accountId) as { person_id: number } | undefined;

  if (existing) {
    // Only a single-identity person tracks the provider's name. Once identities are
    // merged, whichever was upserted last would otherwise win, flipping the name
    // between Discover runs.
    db.prepare(`
      UPDATE people SET display_name = ?
      WHERE id = ? AND (SELECT COUNT(*) FROM person_identities WHERE person_id = ?) = 1
    `).run(displayName, existing.person_id, existing.person_id);
    return existing.person_id;
  }
  // New arrivals are excluded: the workspace holds hundreds of accounts and only
  // ticked ones are ever counted.
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO people (display_name, included) VALUES (?, 0)`,
  ).run(displayName);
  db.prepare(
    `INSERT INTO person_identities (provider, account_id, person_id) VALUES (?, ?, ?)`,
  ).run(provider, accountId, lastInsertRowid);
  return Number(lastInsertRowid);
};

export const upsertServiceIdentity = (
  db: Database.Database, provider: ProviderId, repoKey: string,
  name: string, defaultBranch: string, groupKey: string | null,
): number => {
  const existing = db.prepare(
    `SELECT service_id FROM service_identities WHERE provider = ? AND repo_key = ?`,
  ).get(provider, repoKey) as { service_id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE service_identities SET default_branch = ?, group_key = ? WHERE provider = ? AND repo_key = ?`,
    ).run(defaultBranch, groupKey, provider, repoKey);
    return existing.service_id;
  }
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO services (name, included) VALUES (?, 0)`,
  ).run(name);
  // Bitbucket is a frozen archive, so state follows the provider: no caller can mint an
  // active Bitbucket identity for sync to try (and fail) to fetch.
  const state = provider === "bitbucket" ? "archived" : "active";
  db.prepare(`
    INSERT INTO service_identities (provider, repo_key, service_id, default_branch, group_key, state)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(provider, repoKey, lastInsertRowid, defaultBranch, groupKey, state);
  return Number(lastInsertRowid);
};

// Moves an identity onto another canonical entity and deletes the entity it leaves
// behind if nothing else points at it. Rows in pull_requests/approvals are re-pointed
// too, so the merge is complete rather than cosmetic.
const relink = (
  db: Database.Database,
  identityTable: "person_identities" | "service_identities",
  keyColumn: "account_id" | "repo_key",
  idColumn: "person_id" | "service_id",
  entityTable: "people" | "services",
  provider: ProviderId, key: string, intoId: number,
): void => {
  const tx = db.transaction(() => {
    const row = db.prepare(
      `SELECT ${idColumn} AS id FROM ${identityTable} WHERE provider = ? AND ${keyColumn} = ?`,
    ).get(provider, key) as { id: number } | undefined;
    if (!row || row.id === intoId) return;
    // Nothing is ever un-ticked automatically, so a merge keeps the entity ticked if
    // either side was.
    const wasIncluded = db.prepare(`SELECT included FROM ${entityTable} WHERE id = ?`).get(row.id) as { included: number };
    if (wasIncluded.included) db.prepare(`UPDATE ${entityTable} SET included = 1 WHERE id = ?`).run(intoId);

    db.prepare(
      `UPDATE ${identityTable} SET ${idColumn} = ? WHERE provider = ? AND ${keyColumn} = ?`,
    ).run(intoId, provider, key);
    // Scope to the identity being moved, not the whole old entity: the entity may keep
    // other identities whose rows must stay where they are.
    if (idColumn === "service_id") {
      db.prepare(
        `UPDATE pull_requests SET service_id = ? WHERE service_id = ? AND provider = ? AND repo_key = ?`,
      ).run(intoId, row.id, provider, key);
    } else {
      // pull_requests has no author-account column, so (provider, person_id) is the
      // tightest scope available. Residual: a person holding two identities on the
      // same provider cannot be told apart, so such a move is bounded to that provider.
      db.prepare(
        `UPDATE pull_requests SET person_id = ? WHERE person_id = ? AND provider = ?`,
      ).run(intoId, row.id, provider);
      db.prepare(
        `UPDATE approvals SET person_id = ? WHERE person_id = ? AND provider = ? AND approver_account_id = ?`,
      ).run(intoId, row.id, provider, key);
    }
    const remaining = db.prepare(
      `SELECT COUNT(*) AS c FROM ${identityTable} WHERE ${idColumn} = ?`,
    ).get(row.id) as { c: number };
    if (remaining.c === 0) {
      db.prepare(`DELETE FROM ${entityTable} WHERE id = ?`).run(row.id);
    }
  });
  tx();
};

export const linkPersonIdentity = (
  db: Database.Database, provider: ProviderId, accountId: string, intoPersonId: number,
): void => relink(db, "person_identities", "account_id", "person_id", "people", provider, accountId, intoPersonId);

export const linkServiceIdentity = (
  db: Database.Database, provider: ProviderId, repoKey: string, intoServiceId: number,
): void => relink(db, "service_identities", "repo_key", "service_id", "services", provider, repoKey, intoServiceId);

// The reverse of a merge: gives one identity of a multi-identity entity an entity of its
// own again, excluded like any new arrival and named by the provider's own key. A no-op
// for an identity that already stands alone, so a double click cannot mint a duplicate.
export const splitPersonIdentity = (db: Database.Database, provider: ProviderId, accountId: string): void => {
  db.transaction(() => {
    const row = db.prepare(
      `SELECT person_id AS id FROM person_identities WHERE provider = ? AND account_id = ?`,
    ).get(provider, accountId) as { id: number } | undefined;
    if (!row) return;
    const siblings = db.prepare(`SELECT COUNT(*) AS c FROM person_identities WHERE person_id = ?`).get(row.id) as { c: number };
    if (siblings.c < 2) return;
    const { lastInsertRowid } = db.prepare(`INSERT INTO people (display_name, included) VALUES (?, 0)`).run(accountId);
    linkPersonIdentity(db, provider, accountId, Number(lastInsertRowid));
  })();
};

export const splitServiceIdentity = (db: Database.Database, provider: ProviderId, repoKey: string): void => {
  db.transaction(() => {
    const row = db.prepare(
      `SELECT service_id AS id FROM service_identities WHERE provider = ? AND repo_key = ?`,
    ).get(provider, repoKey) as { id: number } | undefined;
    if (!row) return;
    const siblings = db.prepare(`SELECT COUNT(*) AS c FROM service_identities WHERE service_id = ?`).get(row.id) as { c: number };
    if (siblings.c < 2) return;
    const { lastInsertRowid } = db.prepare(`INSERT INTO services (name, included) VALUES (?, 0)`).run(repoKey);
    linkServiceIdentity(db, provider, repoKey, Number(lastInsertRowid));
  })();
};

export const setServiceIdentityState = (
  db: Database.Database, provider: ProviderId, repoKey: string, state: IdentityState,
): void => {
  db.prepare(
    `UPDATE service_identities SET state = ? WHERE provider = ? AND repo_key = ?`,
  ).run(state, provider, repoKey);
};

type FreshnessRow = { provider: string; last: string; archived: number };

// One row per provider that has actually synced an included service. A provider with
// no data is absent rather than reported as "Never", so a GitHub-only instance shows
// one line instead of an empty Bitbucket row.
export const getLastRefreshedByProvider = (
  db: Database.Database,
): { provider: ProviderId; lastSyncedOn: string; archived: boolean }[] =>
  (db.prepare(`
    SELECT i.provider                                   AS provider,
           MAX(i.last_synced_on)                        AS last,
           MIN(CASE WHEN i.state = 'archived' THEN 1 ELSE 0 END) AS archived
    FROM service_identities i
    JOIN services s ON s.id = i.service_id
    WHERE s.included = 1 AND i.last_synced_on IS NOT NULL
    GROUP BY i.provider
    ORDER BY i.provider
  `).all() as FreshnessRow[]).map((r) => ({
    provider: r.provider as ProviderId,
    lastSyncedOn: r.last,
    archived: !!r.archived,
  }));

// Resolve-or-create for sync, which meets authors and approvers nobody ever discovered.
// Unlike upsertPersonIdentity this never renames: the account id only stands in as a
// name when no better one exists, and must not overwrite a real display name.
export const resolvePersonId = (db: Database.Database, provider: ProviderId, accountId: string): number => {
  const row = db.prepare(
    `SELECT person_id FROM person_identities WHERE provider = ? AND account_id = ?`,
  ).get(provider, accountId) as { person_id: number } | undefined;
  return row ? row.person_id : upsertPersonIdentity(db, provider, accountId, accountId);
};

export const resolveServiceId = (db: Database.Database, provider: ProviderId, repoKey: string): number => {
  const row = db.prepare(
    `SELECT service_id FROM service_identities WHERE provider = ? AND repo_key = ?`,
  ).get(provider, repoKey) as { service_id: number } | undefined;
  return row ? row.service_id : upsertServiceIdentity(db, provider, repoKey, repoKey, "main", null);
};

// Every identity of every included service, archived ones too: sync needs the archived
// siblings to decide whether a service is entirely gone, though it never fetches them.
export const getSyncableIdentities = (db: Database.Database) =>
  getServices(db).filter((s) => s.included).flatMap((s) =>
    s.identities.map((i) => ({
      provider: i.provider, repoKey: i.repoKey, serviceId: s.id,
      defaultBranch: i.defaultBranch, state: i.state,
    })));
