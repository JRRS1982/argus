export type AppConfig = {
  workspace: string;       // Bitbucket workspace slug
  projectKey: string | null; // optional Bitbucket project key to scope repos; null = whole workspace
  dbPath: string;          // path to the SQLite cache file
};

export const config: AppConfig = {
  workspace: process.env.BITBUCKET_WORKSPACE ?? "mvfglobal",
  projectKey: process.env.BITBUCKET_PROJECT_KEY ?? null,
  dbPath: process.env.ARGUS_DB_PATH ?? "data/argus.sqlite",
};

// Demo mode derives entirely from whether this instance can fetch real data.
// Env is injectable so these stay pure and testable.

export const hasBitbucketCredentials = (env: NodeJS.ProcessEnv = process.env): boolean =>
  Boolean(env.BITBUCKET_EMAIL && env.BITBUCKET_API_TOKEN);

// Shown in development (so it can be demoed locally against real data), and on any
// instance with no credentials — which is what a public Vercel deploy always is.
// Never shown on a credentialed production instance, which has real data to display.
export const isDemoAvailable = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.NODE_ENV === "development" || !hasBitbucketCredentials(env);

// With no credentials there is nothing else to show, so demo starts on: a visitor
// lands on a populated dashboard rather than an empty one that reads as broken.
export const isDemoDefaultOn = (env: NodeJS.ProcessEnv = process.env): boolean =>
  !hasBitbucketCredentials(env);
