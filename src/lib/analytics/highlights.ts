import type { InsightsResponse } from "@/types";

export type Highlight = {
  key: "prs" | "services" | "approvals" | "median" | "refreshed";
  label: string;
  // The card's bold headline: an engineer's name on the recognition cards, the
  // count on the "PRs considered" context card.
  engineer: string;
  value: string;
  // The "Data refreshed" card lists one line per provider instead of a headline.
  lines?: { label: string; value: string }[];
};

const PROVIDER_LABEL = { github: "GitHub", bitbucket: "Bitbucket", demo: "Demo" } as const;

// UTC, like formatWindowLabel, so the stamp reads the same wherever it is viewed.
const fmtUtc = (iso: string, withTime: boolean): string =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(iso));

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

  // Context again: when each provider last synced. The tabs read the local cache, so
  // anything merged since is missing until the next refresh. Live providers come first
  // (the number that can still move). An archived one says "archived", not "last
  // pulled": Bitbucket will never be pulled again. A provider with no data never
  // reaches here, so it is omitted rather than shown as "Never".
  const lines = [...insights.refreshedAt]
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.provider.localeCompare(b.provider))
    .map((r) => ({
      label: PROVIDER_LABEL[r.provider],
      value: r.archived ? `archived ${fmtUtc(r.lastSyncedOn, false)}` : fmtUtc(r.lastSyncedOn, true),
    }));
  out.push(
    lines.length > 0
      ? { key: "refreshed", label: "Data refreshed", engineer: "", value: "", lines }
      : {
          key: "refreshed", label: "Data refreshed",
          engineer: "Never",
          value: "run Refresh data on the Team tab",
        },
  );

  return out;
};
