// Marks a failure as belonging to the repo itself — its PR list — rather than to one
// PR inside it. The distinction decides whether a 404 means "this repo is gone": a
// 404 from a single PR's activity/reviews/timeline or from a pagination cursor means
// nothing of the sort, and must never offer to untick a healthy repo.
// Shared by sync and every adapter so there is one mechanism, not one per provider.
const REPO_LEVEL = Symbol.for("argus.repoLevelFailure");

export const tagRepoLevel = (err: unknown): unknown => {
  if (typeof err === "object" && err !== null) {
    Object.defineProperty(err, REPO_LEVEL, { value: true });
  }
  return err;
};

export const isRepoLevel = (err: unknown): boolean =>
  typeof err === "object" && err !== null && REPO_LEVEL in err;
