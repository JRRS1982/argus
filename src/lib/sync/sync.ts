import type Database from "better-sqlite3";
import type { ApprovalRecord, ProviderId, PullRequestRecord, SkippedRepo } from "@/types";
import { upsertPullRequest, replaceApprovals, mergeApprovals, getLastSynced, setLastSynced } from "@/lib/db/queries";
import { resolvePersonId, resolveServiceId } from "@/lib/db/canonical";
import {
  deriveReadyForReview, extractApprovals, type BitbucketApproval,
  fetchPullRequestsUpdatedSince, fetchPullRequestActivity,
} from "@/lib/bitbucket/pulls";
import { sixMonthsAgoIso, EPOCH_ISO } from "@/lib/window";
import { BitbucketApiError } from "@/lib/bitbucket/client";
import { tagRepoLevel, isRepoLevel } from "@/lib/providers/repo-level";

// "deep"  — one /activity call per PR: exact ready-for-review times and the full
//           approval history. Costs ~1 request per PR.
// "fast"  — list calls only: approvals come from participants[], and every PR's
//           review time falls back to createdOn. Costs ~1 request per 50 PRs.
export type SyncMode = "fast" | "deep";

export type SyncDeps = {
  db: Database.Database;
  workspace: string;
  auth: string;
  fetchPRs: typeof fetchPullRequestsUpdatedSince;
  fetchActivity: typeof fetchPullRequestActivity;
  mode?: SyncMode;
  // Ignore the incremental cursor and fetch every PR the repo has ever had. A normal
  // first sync only reaches back 6 months, so "All time" is incomplete until a
  // backfill has run. Idempotent: everything is upserted.
  backfill?: boolean;
};

const PROVIDER: ProviderId = "bitbucket";

export const syncRepo = async (
  deps: SyncDeps,
  repoSlug: string,
  nowIso: string,
): Promise<{ repoSlug: string; prCount: number }> => {
  const since = deps.backfill
    ? EPOCH_ISO
    : getLastSynced(deps.db, PROVIDER, repoSlug) ?? sixMonthsAgoIso(nowIso);
  let partials;
  try {
    partials = await deps.fetchPRs(deps.workspace, repoSlug, since, deps.auth);
  } catch (err) {
    throw tagRepoLevel(err);
  }
  const mode = deps.mode ?? "deep";
  // Registered only once the repo has answered, so a repo that 404s leaves no trace.
  const serviceId = resolveServiceId(deps.db, PROVIDER, repoSlug);

  const toApproval = (a: BitbucketApproval): ApprovalRecord => ({
    provider: PROVIDER, repoKey: a.repoSlug, prNumber: a.prId,
    approverAccountId: a.approverAccountId,
    personId: resolvePersonId(deps.db, PROVIDER, a.approverAccountId),
    approvedOn: a.approvedOn,
  });

  for (const partial of partials) {
    // `approvals` must not reach upsertPullRequest — better-sqlite3 rejects
    // named parameters that the statement does not declare.
    const { approvals: participantApprovals, id, repoSlug: _slug, authorAccountId, ...prFields } = partial;
    // Bitbucket's merge time is the updated_on proxy, never an exact timestamp.
    const base = {
      ...prFields, provider: PROVIDER, repoKey: repoSlug, number: id, serviceId,
      personId: resolvePersonId(deps.db, PROVIDER, authorAccountId),
      mergedOnPrecision: prFields.mergedOn === null ? null : "derived",
    } as const;

    if (mode === "fast") {
      const pr: PullRequestRecord = {
        ...base, readyForReviewOn: prFields.createdOn, readyForReviewPrecision: "fallback",
      };
      upsertPullRequest(deps.db, pr);
      mergeApprovals(deps.db, participantApprovals.map(toApproval));
      continue;
    }
    const activity = await deps.fetchActivity(deps.workspace, repoSlug, id, deps.auth);
    const { readyForReviewOn, readyIsFallback } = deriveReadyForReview(prFields.createdOn, activity);
    const pr: PullRequestRecord = {
      ...base, readyForReviewOn, readyForReviewPrecision: readyIsFallback ? "fallback" : "derived",
    };
    upsertPullRequest(deps.db, pr);
    replaceApprovals(deps.db, PROVIDER, repoSlug, id, extractApprovals(repoSlug, id, activity).map(toApproval));
  }

  setLastSynced(deps.db, PROVIDER, repoSlug, nowIso);
  return { repoSlug, prCount: partials.length };
};

const toSkipped = (repoSlug: string, err: unknown): SkippedRepo => {
  const status = err instanceof BitbucketApiError ? err.status : null;
  if (err instanceof BitbucketApiError) {
    // The only record of which URL was actually refused. Without it a typo'd
    // workspace slug and a genuinely deleted repo produce identical output.
    console.error(`[sync] ${repoSlug}: ${err.status} ${err.statusText} — ${err.url}`);
  } else {
    console.error(`[sync] ${repoSlug}:`, err);
  }
  return {
    repoSlug,
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

const notAttempted = (repoSlug: string): SkippedRepo => ({
  repoSlug,
  reason: "Not attempted — the refresh stopped early.",
  status: null,
  missing: false,
});

// One repo's failure must not cost the rest of the run. Repos are synced in
// sequence and each has its own cursor, so a failure is isolated by construction:
// the failing repo keeps its old cursor and retries the same range next time,
// while every other repo still advances.
export const syncAll = async (
  deps: SyncDeps,
  repoSlugs: string[],
  nowIso: string,
): Promise<{
  repos: { repoSlug: string; prCount: number }[];
  skipped: SkippedRepo[];
  totalPrs: number;
}> => {
  const repos: { repoSlug: string; prCount: number }[] = [];
  const skipped: SkippedRepo[] = [];
  for (const [index, slug] of repoSlugs.entries()) {
    try {
      repos.push(await syncRepo(deps, slug, nowIso));
    } catch (err) {
      const skip = toSkipped(slug, err);
      skipped.push(skip);
      if (isRunWide(skip.status)) {
        skipped.push(...repoSlugs.slice(index + 1).map(notAttempted));
        break;
      }
    }
  }
  return { repos, skipped, totalPrs: repos.reduce((sum, r) => sum + r.prCount, 0) };
};
