import type { InsightsResponse } from "@/types";

export type Highlight = {
  key: "services" | "approvals" | "median";
  label: string;
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

  return out;
};
