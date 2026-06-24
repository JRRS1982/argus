// Returns the ISO timestamp six months before `nowIso`.
// Pure: caller supplies the reference instant so the result is testable.
export const sixMonthsAgoIso = (nowIso: string): string => {
  const d = new Date(nowIso);
  d.setUTCMonth(d.getUTCMonth() - 6);
  return d.toISOString();
};
