export const reviewDurationMs = (
  pr: { readyForReviewOn: string; mergedOn: string | null },
): number | null => {
  if (!pr.mergedOn) return null;
  const ms = new Date(pr.mergedOn).getTime() - new Date(pr.readyForReviewOn).getTime();
  return ms < 0 ? 0 : ms;
};
