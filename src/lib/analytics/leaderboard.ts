import type { LeaderboardRow, LeaderboardPR, PullRequestRecord, RepoRecord, UserRecord } from "@/types";
import { reviewDurationMs } from "./duration";

export const computeLeaderboard = (
  prs: PullRequestRecord[],
  repos: RepoRecord[],
  users: UserRecord[],
  sinceIso: string,
): LeaderboardRow[] => {
  const mainBranchBySlug = new Map(repos.map((r) => [r.slug, r.mainBranch]));
  const includedUsers = users.filter((u) => u.included);
  const nameByAccount = new Map(includedUsers.map((u) => [u.accountId, u.displayName]));

  const eligible = prs.filter(
    (pr) =>
      pr.state === "MERGED" &&
      pr.mergedOn !== null &&
      pr.mergedOn >= sinceIso &&
      pr.destinationBranch === mainBranchBySlug.get(pr.repoSlug) &&
      nameByAccount.has(pr.authorAccountId),
  );

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
      averageReviewMs: Math.round(total / items.length),
      prs: items,
    });
  }

  rows.sort((a, b) => a.averageReviewMs - b.averageReviewMs); // fastest first
  return rows;
};
