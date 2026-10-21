// src/lib/analytics/linking.ts

// Lower-case and strip the separators that differ between providers. Deliberately
// NOT a fuzzy match: chameleon-qa and chameleon-acceptance-tests are different repos,
// and a near-match heuristic would merge two services whose histories must stay apart.
// A rename like benchmarkmeapp -> benchmarkme is resolved by hand on the Team tab,
// where a wrong guess is visible and reversible.
export const normaliseKey = (value: string): string =>
  value.trim().toLowerCase().replace(/[-_.\s]/g, "");

// Returns the single candidate whose normalised name equals the given one, else null.
// Null on ambiguity too (foo-bar and foo_bar both present) and on a name that
// normalises to nothing: a missed link is one click to fix, a wrong one silently
// fuses two histories.
export const findLinkTarget = <T extends { id: number; name: string }>(
  candidates: T[], name: string,
): T | null => {
  const key = normaliseKey(name);
  if (key === "") return null;
  const hits = candidates.filter((c) => normaliseKey(c.name) === key);
  return hits.length === 1 ? hits[0] : null;
};
