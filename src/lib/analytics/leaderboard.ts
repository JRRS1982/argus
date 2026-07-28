import type { LeaderboardRow, LeaderboardPR, PullRequestRecord, RepoRecord, UserRecord } from "@/types";
import { reviewDurationMs } from "./duration";
import { buildPrScope, isInScope } from "./scope";

// Median of a non-empty list; robust to the long-tail PRs that skew the mean.
const medianMs = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

export const computeLeaderboard = (
  prs: PullRequestRecord[],
  repos: RepoRecord[],
  users: UserRecord[],
  sinceIso: string,
): LeaderboardRow[] => {
  const scope = buildPrScope(repos);
  const includedUsers = users.filter((u) => u.included);
  const nameByAccount = new Map(includedUsers.map((u) => [u.accountId, u.displayName]));

  const inScope = prs.filter((pr) => isInScope(pr, scope) && nameByAccount.has(pr.authorAccountId));

  const eligible = inScope.filter(
    (pr) => pr.state === "MERGED" && pr.mergedOn !== null && pr.mergedOn >= sinceIso,
  );

  // Still-open PRs have no landing time to measure, so they cannot appear in the
  // durations — but they are counted on the PRs-created tab. Reporting them here
  // makes the two tabs reconcile: merged + open = that engineer's PRs created.
  // Windowed on creation date, matching how the PRs-created matrix is windowed.
  const openByAuthor = new Map<string, number>();
  for (const pr of inScope) {
    if (pr.state !== "OPEN" || pr.createdOn < sinceIso) continue;
    openByAuthor.set(pr.authorAccountId, (openByAuthor.get(pr.authorAccountId) ?? 0) + 1);
  }

  const byAuthor = new Map<string, LeaderboardPR[]>();
  for (const pr of eligible) {
    const ms = reviewDurationMs(pr);
    if (ms === null) continue;
    const item: LeaderboardPR = {
      id: pr.id, repoSlug: pr.repoSlug, title: pr.title, url: pr.url,
      reviewMs: ms, readyIsFallback: pr.readyIsFallback,
    };
    const list = byAuthor.get(pr.authorAccountId) ?? [];
    list.push(item);
    byAuthor.set(pr.authorAccountId, list);
  }

  const rows: LeaderboardRow[] = [];
  for (const [accountId, items] of byAuthor) {
    const total = items.reduce((s, p) => s + p.reviewMs, 0);
    items.sort((a, b) => b.reviewMs - a.reviewMs); // slowest first within the row
    rows.push({
      accountId,
      displayName: nameByAccount.get(accountId) ?? accountId,
      prCount: items.length,
      openPrCount: openByAuthor.get(accountId) ?? 0,
      averageReviewMs: Math.round(total / items.length),
      medianReviewMs: medianMs(items.map((p) => p.reviewMs)),
      prs: items,
    });
  }

  rows.sort((a, b) => a.medianReviewMs - b.medianReviewMs); // fastest first, by median (outlier-resistant)
  return rows;
};
