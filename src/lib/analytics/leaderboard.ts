import type { LeaderboardRow, LeaderboardPR, PullRequestRecord, Person, Service } from "@/types";
import { reviewDurationMs } from "./duration";
import { buildPrScope, isInScope } from "./scope";
import { byDisplayName } from "./sort";

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
  services: Service[],
  people: Person[],
  sinceIso: string,
): LeaderboardRow[] => {
  const scope = buildPrScope(services);
  const nameByPerson = new Map(people.filter((p) => p.included).map((p) => [p.id, p.displayName]));

  const inScope = prs.filter((pr) => isInScope(pr, scope) && nameByPerson.has(pr.personId));

  const eligible = inScope.filter(
    (pr) => pr.state === "MERGED" && pr.mergedOn !== null && pr.mergedOn >= sinceIso,
  );

  // Still-open PRs have no landing time to measure, so they cannot appear in the
  // durations — but they are counted on the PRs-created tab. Reporting them here
  // makes the two tabs reconcile: merged + open = that engineer's PRs created.
  // Windowed on creation date, matching how the PRs-created matrix is windowed.
  const openByAuthor = new Map<number, number>();
  for (const pr of inScope) {
    if (pr.state !== "OPEN" || pr.createdOn < sinceIso) continue;
    openByAuthor.set(pr.personId, (openByAuthor.get(pr.personId) ?? 0) + 1);
  }

  const byAuthor = new Map<number, LeaderboardPR[]>();
  for (const pr of eligible) {
    const ms = reviewDurationMs(pr);
    if (ms === null) continue;
    const item: LeaderboardPR = {
      number: pr.number, provider: pr.provider, repoKey: pr.repoKey, title: pr.title, url: pr.url,
      reviewMs: ms, readyForReviewPrecision: pr.readyForReviewPrecision,
      // A merged PR always has mergedOn; a missing precision is treated as the weaker claim.
      mergedOnPrecision: pr.mergedOnPrecision ?? "derived",
    };
    const list = byAuthor.get(pr.personId) ?? [];
    list.push(item);
    byAuthor.set(pr.personId, list);
  }

  const rows: LeaderboardRow[] = [];
  for (const [personId, items] of byAuthor) {
    const total = items.reduce((s, p) => s + p.reviewMs, 0);
    items.sort((a, b) => b.reviewMs - a.reviewMs); // slowest first within the row
    rows.push({
      personId,
      displayName: nameByPerson.get(personId) ?? String(personId),
      prCount: items.length,
      openPrCount: openByAuthor.get(personId) ?? 0,
      averageReviewMs: Math.round(total / items.length),
      medianReviewMs: medianMs(items.map((p) => p.reviewMs)),
      prs: items,
    });
  }

  // Alphabetical, not fastest-first: this is a record of contribution, not a ranking.
  // Median and average remain as columns for anyone who wants them.
  rows.sort(byDisplayName);
  return rows;
};
