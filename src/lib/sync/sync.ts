import type Database from "better-sqlite3";
import type { PullRequestRecord } from "@/types";
import { upsertPullRequest, replaceApprovals, getLastSynced, setLastSynced } from "@/lib/db/queries";
import {
  deriveReadyForReview, extractApprovals,
  fetchPullRequestsUpdatedSince, fetchPullRequestActivity,
} from "@/lib/bitbucket/pulls";
import { sixMonthsAgoIso } from "@/lib/window";

export type SyncDeps = {
  db: Database.Database;
  workspace: string;
  auth: string;
  fetchPRs: typeof fetchPullRequestsUpdatedSince;
  fetchActivity: typeof fetchPullRequestActivity;
};

export const syncRepo = async (
  deps: SyncDeps,
  repoSlug: string,
  nowIso: string,
): Promise<{ repoSlug: string; prCount: number }> => {
  const since = getLastSynced(deps.db, repoSlug) ?? sixMonthsAgoIso(nowIso);
  const partials = await deps.fetchPRs(deps.workspace, repoSlug, since, deps.auth);

  for (const partial of partials) {
    const activity = await deps.fetchActivity(deps.workspace, repoSlug, partial.id, deps.auth);
    const { readyForReviewOn, readyIsFallback } = deriveReadyForReview(partial.createdOn, activity);
    const pr: PullRequestRecord = { ...partial, readyForReviewOn, readyIsFallback };
    upsertPullRequest(deps.db, pr);
    replaceApprovals(deps.db, repoSlug, partial.id, extractApprovals(repoSlug, partial.id, activity));
  }

  setLastSynced(deps.db, repoSlug, nowIso);
  return { repoSlug, prCount: partials.length };
};

export const syncAll = async (
  deps: SyncDeps,
  repoSlugs: string[],
  nowIso: string,
): Promise<{ repos: { repoSlug: string; prCount: number }[]; totalPrs: number }> => {
  const repos: { repoSlug: string; prCount: number }[] = [];
  for (const slug of repoSlugs) {
    repos.push(await syncRepo(deps, slug, nowIso));
  }
  return { repos, totalPrs: repos.reduce((sum, r) => sum + r.prCount, 0) };
};
