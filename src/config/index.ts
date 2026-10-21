export type AppConfig = {
  workspace: string;       // Bitbucket workspace slug
  projectKey: string | null; // optional Bitbucket project key to scope repos; null = whole workspace
  dbPath: string;          // path to the SQLite cache file
  githubToken: string | null; // GitHub token; null = GitHub not configured
  githubOrg: string;       // GitHub organisation to discover
  // Argus shares the user's token, so a refresh must never spend all of it.
  githubReserve: number;           // requests always left for the user's own GitHub use
  githubMaxRequestsPerRun: number; // most any one refresh may spend
  githubMinRequestIntervalMs: number; // smallest gap between requests
};

// A malformed or negative override would silently disable the protection it configures,
// so anything that is not a non-negative number falls back to the default.
const positiveInt = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw);
  return raw !== undefined && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
};

export const config: AppConfig = {
  workspace: process.env.BITBUCKET_WORKSPACE ?? "mvfglobal",
  projectKey: process.env.BITBUCKET_PROJECT_KEY ?? null,
  dbPath: process.env.ARGUS_DB_PATH ?? "data/argus.sqlite",
  githubToken: process.env.GITHUB_TOKEN ?? null,
  githubOrg: process.env.GITHUB_ORG ?? "mvfglobal",
  // 1,000 of a standard 5,000/hour allowance: enough for a normal day's own work even
  // immediately after a full backfill.
  githubReserve: positiveInt(process.env.GITHUB_RATE_LIMIT_RESERVE, 1000),
  // Keeps one run from draining the hour in a burst, so the quota recovers in steps
  // rather than bottoming out. A first backfill therefore takes a few runs.
  githubMaxRequestsPerRun: positiveInt(process.env.GITHUB_MAX_REQUESTS_PER_RUN, 3000),
  // Requests are already sequential; this is slack against GitHub's secondary limits,
  // which trigger on sustained bursts rather than on the hourly count.
  githubMinRequestIntervalMs: positiveInt(process.env.GITHUB_MIN_REQUEST_INTERVAL_MS, 50),
};

// Demo mode derives entirely from whether this instance can fetch real data.
// Env is injectable so these stay pure and testable.

export const hasBitbucketCredentials = (env: NodeJS.ProcessEnv = process.env): boolean =>
  Boolean(env.BITBUCKET_EMAIL && env.BITBUCKET_API_TOKEN);

export const hasGitHubCredentials = (env: NodeJS.ProcessEnv = process.env): boolean =>
  Boolean(env.GITHUB_TOKEN);

// Shown in development (so it can be demoed locally against real data), and on any
// instance with no provider configured — which is what a public Vercel deploy always is.
// Never shown on a credentialed production instance, which has real data to display.
// Generalised from the Bitbucket-only check so a GitHub-credentialled instance stops
// offering it too.
export const isDemoAvailable = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.NODE_ENV === "development" || (!hasBitbucketCredentials(env) && !hasGitHubCredentials(env));

// With no provider configured there is nothing else to show, so demo starts on: a visitor
// lands on a populated dashboard rather than an empty one that reads as broken.
export const isDemoDefaultOn = (env: NodeJS.ProcessEnv = process.env): boolean =>
  !hasBitbucketCredentials(env) && !hasGitHubCredentials(env);
