import type { ProviderId } from "@/types";
import { buildDemoDataset } from "@/lib/demo/fixture";
import { mulberry32 } from "@/lib/demo/random";
import type { FetchedPullRequest, PullRequestProvider } from "./types";

const HOUR_MS = 3_600_000;

// An in-memory provider for tests, built from the demo dataset so the test double and
// the demo cannot drift apart: change the demo's shape and this follows.
//
// Its id is "github", not a new "fixture" member of ProviderId. ProviderId is the type of
// a value persisted on every PR, approval and identity row, so widening it would put a
// test-only value into production types and every exhaustive switch over it. The fixture
// declares GitHub-like capabilities (exact merge times), which is the one thing it exists
// to contrast with Bitbucket's "derived"; borrowing GitHub's id is the honest pairing.
// The cost: never register it alongside the real GitHub adapter.
const FIXTURE_ID: ProviderId = "github";

// Seed decides which merged PRs become CLOSED (abandoned) so every state is present.
// `nowIso` is injectable so a test can pin the clock; the default keeps dates relative
// to now, like the demo.
export const createFixtureProvider = (
  seed = 1,
  nowIso: string = new Date().toISOString(),
): PullRequestProvider => {
  const data = buildDemoDataset(nowIso);
  const rand = mulberry32(seed);
  const accountIdOf = (personId: number): string =>
    data.people[personId - 1].identities[0].accountId;
  // Every state must be present in every repo, by construction: a contract that merely
  // hopes the seed yields a CLOSED PR cannot catch a provider that mislabels closed-but-
  // unmerged work as MERGED. So per repo the first merged PR is forced to CLOSED and the
  // second is reopened; the seed then abandons a further slice for variety.
  const abandoned = new Set<string>();
  const reopened = new Set<string>();
  const mergedSeen = new Map<string, number>();
  for (const pr of data.prs) {
    if (pr.state !== "MERGED") continue;
    const key = `${pr.repoKey}#${pr.number}`;
    const n = (mergedSeen.get(pr.repoKey) ?? 0) + 1;
    mergedSeen.set(pr.repoKey, n);
    if (n === 1 || rand() < 0.15) abandoned.add(key);
    else if (n === 2) reopened.add(key);
  }

  // Fixed by construction, so a contract run is deterministic.
  const repos = data.services.map((s) => ({
    repoKey: s.identities[0].repoKey, name: s.name,
    defaultBranch: s.identities[0].defaultBranch, groupKey: s.identities[0].groupKey,
  }));

  return {
    id: FIXTURE_ID,
    label: "Fixture",
    // exact: the opposite of Bitbucket on purpose, so the contract sees both values.
    capabilities: {
      mergeTimestamps: "exact", readyForReviewTimestamps: "exact", approvalTimestamps: "exact",
    },
    listPeople: async () =>
      data.people.map((p) => ({ accountId: p.identities[0].accountId, displayName: p.displayName })),
    listRepositories: async () => repos,

    listPullRequests: async (repo, updatedSince, detail) => {
      const since = new Date(updatedSince).getTime();
      const out: FetchedPullRequest[] = [];
      for (const pr of data.prs) {
        if (pr.repoKey !== repo.repoKey) continue;
        const closed = abandoned.has(`${pr.repoKey}#${pr.number}`);
        const reopen = reopened.has(`${pr.repoKey}#${pr.number}`);
        const mergedOn = closed || reopen ? null : pr.mergedOn;
        const updatedOn = new Date(mergedOn ?? pr.createdOn).getTime();
        if (updatedOn < since) continue;

        const { serviceId: _serviceId, personId, ...rest } = pr;
        void _serviceId;
        const full = detail === "full";
        out.push({
          pullRequest: {
            ...rest,
            provider: FIXTURE_ID,
            authorAccountId: accountIdOf(personId),
            state: closed ? "CLOSED" : reopen ? "OPEN" : pr.state,
            mergedOn,
            mergedOnPrecision: mergedOn === null ? null : "exact",
            // A summary list cannot see the draft→ready transition; per-PR detail can.
            readyForReviewOn: full
              ? new Date(new Date(pr.createdOn).getTime() + HOUR_MS).toISOString()
              : pr.createdOn,
            readyForReviewPrecision: full ? "exact" : "fallback",
          },
          approvals: data.approvals
            .filter((a) => a.repoKey === pr.repoKey && a.prNumber === pr.number)
            .map(({ personId: _p, ...a }) => ({
              ...a, provider: FIXTURE_ID, approvedOn: full ? a.approvedOn : null,
            })),
          approvalsAreComplete: full,
        });
      }
      return out;
    },
  };
};
