import type { ProviderId } from "@/types";
import type { PullRequestProvider } from "./types";

// Throws on a duplicate id. The test fixture deliberately claims "github" (ProviderId is
// the persisted discriminator on every pull_requests/approvals row, so it was not
// widened). If the fixture and the real adapter were both registered, fixture PRs would
// be stored under provider = "github", indistinguishable from real data.
export const createProviderRegistry = (providers: PullRequestProvider[]) => {
  const byId = new Map<ProviderId, PullRequestProvider>();
  for (const p of providers) {
    if (byId.has(p.id)) throw new Error(`Provider "${p.id}" is registered twice; ids must be unique.`);
    byId.set(p.id, p);
  }
  return {
    all: (): PullRequestProvider[] => [...byId.values()],
    get: (id: ProviderId): PullRequestProvider => {
      const p = byId.get(id);
      if (!p) throw new Error(`No provider registered for "${id}".`);
      return p;
    },
  };
};
