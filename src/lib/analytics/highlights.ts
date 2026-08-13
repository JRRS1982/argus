import type { InsightsResponse } from "@/types";

export type Highlight = {
  key: "prs" | "services" | "approvals" | "median" | "refreshed";
  label: string;
  // The card's bold headline: an engineer's name on the recognition cards, the
  // count on the "PRs considered" context card.
  engineer: string;
  value: string;
};

// Index of the largest value, or null when nothing is above zero. Ties take the
// first index; rows are already alphabetical, so the result is deterministic.
const argMax = (values: number[]): number | null =>
  values.reduce<number | null>(
    (best, n, i) => (n > 0 && (best === null || n > values[best]) ? i : best),
    null,
  );

const fmtDuration = (ms: number): string => {
  const hours = ms / 3_600_000;
  return hours < 24 ? `${hours.toFixed(1)}h` : `${(hours / 24).toFixed(1)}d`;
};

// Recognition, not ranking: each entry names one person for something worth doing.
export const computeHighlights = (insights: InsightsResponse): Highlight[] => {
  const out: Highlight[] = [];

  // Context, not recognition: how many PRs the selected window considers (opened in
  // window by an included engineer in an included repo, merged or still open — the
  // PRs-created row totals, so it cannot disagree with that tab). Always shown, even
  // at 0: this is the number that visibly moves after a refresh or backfill.
  out.push({
    key: "prs", label: "PRs considered",
    engineer: insights.prsCreated.rowTotals.reduce((a, b) => a + b, 0).toLocaleString("en-GB"),
    value: "opened in the selected window",
  });

  const services = insights.prsCreated.extraColumn;
  if (services) {
    const i = argMax(services.values);
    if (i !== null) {
      out.push({
        key: "services", label: "Broadest reach",
        engineer: insights.prsCreated.rowUsers[i].displayName,
        value: String(services.values[i]),
      });
    }
  }

  // Column totals, not row totals: rows are approvals *received*, columns are
  // approvals *given* — this celebrates reviewing others' work, not being reviewed.
  const givenIdx = argMax(insights.approvals.colTotals);
  if (givenIdx !== null) {
    out.push({
      key: "approvals", label: "Most reviews for others",
      engineer: insights.approvals.colHeaders[givenIdx].label,
      value: String(insights.approvals.colTotals[givenIdx]),
    });
  }

  if (insights.leaderboard.length > 0) {
    const fastest = insights.leaderboard.reduce((a, b) =>
      b.medianReviewMs < a.medianReviewMs ? b : a);
    out.push({
      key: "median", label: "Quickest to land",
      engineer: fastest.displayName,
      value: fmtDuration(fastest.medianReviewMs),
    });
  }

  // Context again: when the cache last pulled from Bitbucket. The tabs read the
  // local cache, so anything merged since this instant is missing until the next
  // refresh. Runs on the client, so the local timezone is the right one.
  out.push(
    insights.lastRefreshedAt
      ? {
          key: "refreshed", label: "Data refreshed",
          engineer: new Date(insights.lastRefreshedAt).toLocaleString("en-GB", {
            day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
          }),
          value: "last pull from Bitbucket",
        }
      : {
          key: "refreshed", label: "Data refreshed",
          engineer: "Never",
          value: "run Refresh data on the Team tab",
        },
  );

  return out;
};
