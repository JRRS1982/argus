// src/lib/discovery/discover.ts
import type Database from "better-sqlite3";
import type { PullRequestProvider } from "@/lib/providers/types";
import type { ProviderId } from "@/types";
import { findLinkTarget } from "@/lib/analytics/linking";
import {
  getPeople, getServices, upsertPersonIdentity, upsertServiceIdentity,
  linkPersonIdentity, linkServiceIdentity,
} from "@/lib/db/canonical";

export type DiscoverSummary = {
  provider: ProviderId;
  repos: number; people: number;
  linkedRepos: number; linkedPeople: number;
};

const identityKnown = (
  db: Database.Database, table: "service_identities" | "person_identities",
  keyColumn: "repo_key" | "account_id", provider: ProviderId, key: string,
): boolean => !!db.prepare(
  `SELECT 1 FROM ${table} WHERE provider = ? AND ${keyColumn} = ?`,
).get(provider, key);

// Add-only by construction: every write is an upsert (which never touches `included`
// and never re-homes a known identity) or a link of an identity that did not exist a
// moment ago. A known identity is never looked at by the matcher, so a hand-made
// merge — or a hand-made un-merge — survives every re-run, and a second run finds
// every identity known and changes nothing.
export const discoverProvider = async (
  db: Database.Database, provider: PullRequestProvider,
): Promise<DiscoverSummary> => {
  const [repos, people] = await Promise.all([provider.listRepositories(), provider.listPeople()]);
  const summary: DiscoverSummary = {
    provider: provider.id, repos: repos.length, people: people.length,
    linkedRepos: 0, linkedPeople: 0,
  };

  db.transaction(() => {
    for (const r of repos) {
      const known = identityKnown(db, "service_identities", "repo_key", provider.id, r.repoKey);
      // Candidates exclude services already holding an identity from this provider:
      // two repos of one provider are two repos, whatever their names normalise to.
      const target = known ? null : findLinkTarget(
        getServices(db).filter((s) => !s.identities.some((i) => i.provider === provider.id)), r.name,
      );
      upsertServiceIdentity(db, provider.id, r.repoKey, r.name, r.defaultBranch, r.groupKey);
      if (target) {
        linkServiceIdentity(db, provider.id, r.repoKey, target.id);
        summary.linkedRepos++;
      }
    }
    for (const p of people) {
      const known = identityKnown(db, "person_identities", "account_id", provider.id, p.accountId);
      const target = known ? null : findLinkTarget(
        getPeople(db)
          .filter((x) => !x.identities.some((i) => i.provider === provider.id))
          .map((x) => ({ id: x.id, name: x.displayName })),
        p.displayName,
      );
      upsertPersonIdentity(db, provider.id, p.accountId, p.displayName);
      if (target) {
        linkPersonIdentity(db, provider.id, p.accountId, target.id);
        summary.linkedPeople++;
      }
    }
  })();
  return summary;
};
