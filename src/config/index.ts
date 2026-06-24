export type AppConfig = {
  workspace: string;       // Bitbucket workspace slug, e.g. "mvfglobal"
  projectKey: string | null; // optional Bitbucket project key to scope repos; null = whole workspace
  dbPath: string;          // path to the SQLite cache file
};

export const config: AppConfig = {
  workspace: process.env.BITBUCKET_WORKSPACE ?? "mvfglobal",
  projectKey: process.env.BITBUCKET_PROJECT_KEY ?? null,
  dbPath: process.env.ARGUS_DB_PATH ?? "data/argus.sqlite",
};
