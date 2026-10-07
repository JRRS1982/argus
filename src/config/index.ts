export type AppConfig = {
  workspace: string;       // Bitbucket workspace slug
  projectKey: string | null; // optional Bitbucket project key to scope repos; null = whole workspace
  dbPath: string;          // path to the SQLite cache file
  githubToken: string | null; // GitHub token; null = GitHub not configured
  githubOrg: string;       // GitHub organisation to discover
};

export const config: AppConfig = {
  workspace: process.env.BITBUCKET_WORKSPACE ?? "mvfglobal",
  projectKey: process.env.BITBUCKET_PROJECT_KEY ?? null,
  dbPath: process.env.ARGUS_DB_PATH ?? "data/argus.sqlite",
  githubToken: process.env.GITHUB_TOKEN ?? null,
  githubOrg: process.env.GITHUB_ORG ?? "mvfglobal",
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
