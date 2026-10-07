import type Database from "better-sqlite3";
import type {
  ApprovalRecord, IdentityState, ProviderId, PullRequestRecord, SkippedRepo,
} from "@/types";
import { upsertPullRequest, replaceApprovals, mergeApprovals, getLastSynced, setLastSynced } from "@/lib/db/queries";
import { resolvePersonId, resolveServiceId } from "@/lib/db/canonical";
import { sixMonthsAgoIso, EPOCH_ISO } from "@/lib/window";
import {
  ProviderApiError, type DetailLevel, type PullRequestProvider,
} from "@/lib/providers/types";
import { isRepoLevel } from "@/lib/providers/repo-level";

export type SyncDeps = {
  db: Database.Database;
  providers: Partial<Record<ProviderId, PullRequestProvider>>;
  // Ignore the incremental cursor and fetch every PR the repo has ever had. A normal
  // first sync only reaches back 6 months, so "All time" is incomplete until a
  // backfill has run. Idempotent: everything is upserted.
  backfill?: boolean;
  // Detail for providers whose summary is genuinely cheaper and sufficient. See detailFor.
  detail?: DetailLevel;
};

export type SyncableIdentity = {
  provider: ProviderId;
  repoKey: string;
  serviceId: number;
  defaultBranch: string;
  state: IdentityState;
};

export type SyncedRepo = { provider: ProviderId; repoKey: string; prCount: number };

// Present when the run aborted on a credential or rate-limit failure rather than
// finishing. A large GitHub backfill is expected to hit this: what completed is saved
// (each identity has its own cursor) and running again carries on.
export type StoppedEarly = { provider: ProviderId; status: number; reason: string };

export type SyncSummary = {
  repos: SyncedRepo[];
  skipped: SkippedRepo[];
  totalPrs: number;
  stoppedEarly: StoppedEarly | null;
};

// GitHub's PR list carries no review data at all, so a summary fetch yields no approvals
// and an incremental run on summary would leave the Approvals tab permanently short.
// An incremental run touches few PRs, so full detail (timeline + reviews, two requests
// per PR) is cheap there; it is only a backfill that is expensive, and that must be full
// anyway. Bitbucket's participants[] does carry approvals, so it may use the cheap path
// on incremental runs.
const detailFor = (provider: PullRequestProvider, deps: SyncDeps): DetailLevel => {
  if (provider.id === "github" || deps.backfill) return "full";
  return deps.detail ?? "summary";
};

const syncIdentity = async (
  deps: SyncDeps, identity: SyncableIdentity, nowIso: string,
): Promise<SyncedRepo> => {
  const { provider: providerId, repoKey } = identity;
  const provider = deps.providers[providerId];
  if (!provider) throw new Error(`${providerId} is not configured.`);

  const since = deps.backfill
    ? EPOCH_ISO
    : getLastSynced(deps.db, providerId, repoKey) ?? sixMonthsAgoIso(nowIso);

  // The adapter, not sync, tags its own PR-list failure as repo-level: only it knows
  // which of its calls were the list and which were per-PR timeline/review fetches.
  const fetched = await provider.listPullRequests(
    { repoKey, defaultBranch: identity.defaultBranch }, since, detailFor(provider, deps),
  );
  // Registered only once the repo has answered, so a repo that 404s leaves no trace.
  const serviceId = resolveServiceId(deps.db, providerId, repoKey);

  for (const { pullRequest, approvals, approvalsAreComplete } of fetched) {
    const { authorAccountId, ...fields } = pullRequest;
    const pr: PullRequestRecord = {
      ...fields, serviceId, personId: resolvePersonId(deps.db, providerId, authorAccountId),
    };
    upsertPullRequest(deps.db, pr);
    const records: ApprovalRecord[] = approvals.map((a) => ({
      ...a, personId: resolvePersonId(deps.db, providerId, a.approverAccountId),
    }));
    // Complete history replaces (so a withdrawn approval disappears); a summary list
    // cannot see withdrawals, so it may only add.
    if (approvalsAreComplete) replaceApprovals(deps.db, providerId, repoKey, pr.number, records);
    else mergeApprovals(deps.db, records);
  }

  setLastSynced(deps.db, providerId, repoKey, nowIso);
  return { provider: providerId, repoKey, prCount: fetched.length };
};

const toSkipped = (identity: SyncableIdentity, err: unknown): SkippedRepo => {
  // ProviderApiError, not BitbucketApiError: narrowing on one provider's subclass
  // would give every other provider status null, so isRunWide() could never fire and
  // none of their rate-limit handling would take effect.
  const status = err instanceof ProviderApiError ? err.status : null;
  const label = `${identity.provider}/${identity.repoKey}`;
  if (err instanceof ProviderApiError) {
    // The only record of which URL was actually refused. Without it a typo'd
    // workspace slug and a genuinely deleted repo produce identical output.
    console.error(`[sync] ${label}: ${err.status} ${err.statusText} — ${err.url}`);
  } else {
    console.error(`[sync] ${label}:`, err);
  }
  return {
    provider: identity.provider,
    repoKey: identity.repoKey,
    reason: err instanceof Error ? err.message : "Unknown error",
    status,
    missing: status === 404 && isRepoLevel(err),
  };
};

// 401 and 429 describe the credential or the account, not one repo. Carrying on
// would issue one more rejected request per remaining repo — and repeated 401s are
// what Atlassian throttles on, while a 429 would have the run hammering away at a
// block it is already subject to. Stop, and report the rest as not attempted.
const isRunWide = (status: number | null): boolean => status === 401 || status === 429;

const notAttempted = (identity: SyncableIdentity): SkippedRepo => ({
  provider: identity.provider,
  repoKey: identity.repoKey,
  reason: "Not attempted — the refresh stopped early.",
  status: null,
  missing: false,
});

// A 404 on one provider's copy of a service says nothing about its other copies, and a
// service holding archived Bitbucket history must never be offered for removal because
// that history cannot be re-fetched. So `missing` survives only when every identity of
// the service — archived and untouched ones included — is itself missing in this run.
const confineMissingToWholeServices = (
  skipped: SkippedRepo[], identities: SyncableIdentity[],
): SkippedRepo[] => {
  const missingKeys = new Set(skipped.filter((s) => s.missing).map((s) => `${s.provider}/${s.repoKey}`));
  const wholeServiceGone = (identity: SyncableIdentity): boolean =>
    identities
      .filter((i) => i.serviceId === identity.serviceId)
      .every((i) => missingKeys.has(`${i.provider}/${i.repoKey}`));
  return skipped.map((s) => {
    if (!s.missing) return s;
    const identity = identities.find((i) => i.provider === s.provider && i.repoKey === s.repoKey);
    return identity && wholeServiceGone(identity) ? s : { ...s, missing: false };
  });
};

// One repo's failure must not cost the rest of the run. Identities are synced in
// sequence and each has its own cursor, so a failure is isolated by construction:
// the failing one keeps its old cursor and retries the same range next time,
// while every other identity still advances.
export const syncAll = async (
  deps: SyncDeps,
  identities: SyncableIdentity[],
  nowIso: string,
): Promise<SyncSummary> => {
  // Archived identities are read-only history. Skipping them before the request is
  // what makes Bitbucket cost nothing and removes any way for a lapsed credential or
  // a deleted repo to stall a refresh. Their cached rows still count in analytics.
  const active = identities.filter((i) => i.state === "active");

  const repos: SyncedRepo[] = [];
  let skipped: SkippedRepo[] = [];
  let stoppedEarly: StoppedEarly | null = null;
  for (const [index, identity] of active.entries()) {
    try {
      repos.push(await syncIdentity(deps, identity, nowIso));
    } catch (err) {
      const skip = toSkipped(identity, err);
      skipped.push(skip);
      if (isRunWide(skip.status)) {
        stoppedEarly = { provider: identity.provider, status: skip.status as number, reason: skip.reason };
        skipped.push(...active.slice(index + 1).map(notAttempted));
        break;
      }
    }
  }
  skipped = confineMissingToWholeServices(skipped, identities);
  return { repos, skipped, totalPrs: repos.reduce((sum, r) => sum + r.prCount, 0), stoppedEarly };
};
