// Human-readable label for the analysis window, e.g. "28 Jan 2026 – 28 Jul 2026".
// Formatted in UTC so it matches the window boundaries the analytics actually use.
export const formatWindowLabel = (sinceIso: string, untilIso: string): string => {
  const fmt = (iso: string): string =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    }).format(new Date(iso));
  return `${fmt(sinceIso)} – ${fmt(untilIso)}`;
};

// Returns the ISO timestamp six months before `nowIso`.
// Pure: caller supplies the reference instant so the result is testable.
export const sixMonthsAgoIso = (nowIso: string): string => {
  const d = new Date(nowIso);
  d.setUTCMonth(d.getUTCMonth() - 6);
  return d.toISOString();
};

export const thirtyDaysAgoIso = (nowIso: string): string => {
  const d = new Date(nowIso);
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString();
};

export type InsightsWindow = "30d" | "6m" | "all";

export const EPOCH_ISO = "1970-01-01T00:00:00.000Z";

export const isInsightsWindow = (value: unknown): value is InsightsWindow =>
  value === "30d" || value === "6m" || value === "all";

// Start of the analysis window. "all" reaches back to the oldest cached PR, so the
// displayed range describes real data rather than the epoch; the cache is never pruned,
// so "all" means everything ever synced, not everything that exists in Bitbucket.
export const resolveSinceIso = (
  window: InsightsWindow,
  nowIso: string,
  earliestIso: string | null,
): string => {
  if (window === "30d") return thirtyDaysAgoIso(nowIso);
  if (window === "6m") return sixMonthsAgoIso(nowIso);
  return earliestIso ?? EPOCH_ISO;
};
