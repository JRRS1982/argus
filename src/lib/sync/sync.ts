import type Database from "better-sqlite3";
import type { PullRequestRecord } from "@/types";
import { upsertPullRequest, replaceApprovals, mergeApprovals, getLastSynced, setLastSynced } from "@/lib/db/queries";
import {
  deriveReadyForReview, extractApprovals,
  fetchPullRequestsUpdatedSince, fetchPullRequestActivity,
} from "@/lib/bitbucket/pulls";
import { sixMonthsAgoIso, EPOCH_ISO } from "@/lib/window";
import { BitbucketApiError } from "@/lib/bitbucket/client";

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

export const syncRepo = async (
  deps: SyncDeps,
  repoSlug: string,
  nowIso: string,
): Promise<{ repoSlug: string; prCount: number }> => {
  const since = deps.backfill
    ? EPOCH_ISO
    : getLastSynced(deps.db, repoSlug) ?? sixMonthsAgoIso(nowIso);
  const partials = await deps.fetchPRs(deps.workspace, repoSlug, since, deps.auth);
  const mode = deps.mode ?? "deep";

  for (const partial of partials) {
    // `approvals` must not reach upsertPullRequest — better-sqlite3 rejects
    // named parameters that the statement does not declare.
    const { approvals: participantApprovals, ...prFields } = partial;

    if (mode === "fast") {
      const pr: PullRequestRecord = {
        ...prFields, readyForReviewOn: prFields.createdOn, readyIsFallback: true,
      };
      upsertPullRequest(deps.db, pr);
      mergeApprovals(deps.db, participantApprovals);
      continue;
    }
    const activity = await deps.fetchActivity(deps.workspace, repoSlug, partial.id, deps.auth);
    const { readyForReviewOn, readyIsFallback } = deriveReadyForReview(prFields.createdOn, activity);
    const pr: PullRequestRecord = { ...prFields, readyForReviewOn, readyIsFallback };
    upsertPullRequest(deps.db, pr);
    replaceApprovals(deps.db, repoSlug, partial.id, extractApprovals(repoSlug, partial.id, activity));
  }

  setLastSynced(deps.db, repoSlug, nowIso);
  return { repoSlug, prCount: partials.length };
};

// A repo that could not be synced at all. `missing` distinguishes a repo that has
// been deleted or hidden from the token (permanent — the roster entry is stale and
// worth removing) from a transient failure like a 503 or a dropped socket, which
// must never invite the user to drop a repo they still want.
export type SkippedRepo = {
  repoSlug: string;
  reason: string;
  status: number | null;
  missing: boolean;
};

const toSkipped = (repoSlug: string, err: unknown): SkippedRepo => {
  const status = err instanceof BitbucketApiError ? err.status : null;
  return {
    repoSlug,
    reason: err instanceof Error ? err.message : "Unknown error",
    status,
    missing: status === 404,
  };
};

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
  for (const slug of repoSlugs) {
    try {
      repos.push(await syncRepo(deps, slug, nowIso));
    } catch (err) {
      skipped.push(toSkipped(slug, err));
    }
  }
  return { repos, skipped, totalPrs: repos.reduce((sum, r) => sum + r.prCount, 0) };
};
