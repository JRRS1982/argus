import type { AppConfig } from "@/config";
import { hasBitbucketCredentials } from "@/config";
import { createBitbucketProvider } from "@/lib/bitbucket/adapter";
import { createGitHubProvider } from "@/lib/github/adapter";
import type { FetchFn } from "@/lib/github/client";
import { createProviderRegistry } from "./registry";
import type { PullRequestProvider } from "./types";

// A provider with no credentials is simply not active: it is absent from the registry,
// so nothing can call it and nothing fails because of it. Routed through
// createProviderRegistry so its duplicate-id guard still applies to whatever is built.
export const createConfiguredRegistry = (
  cfg: Pick<AppConfig, "workspace" | "projectKey" | "githubToken" | "githubOrg">,
  env: NodeJS.ProcessEnv = process.env,
  // Wraps GitHub's fetch so every call it makes — list, timeline, reviews, GraphQL — is
  // counted and paced by one budget. Applied here rather than inside the adapter so the
  // caller that must report the budget afterwards is the one that owns it.
  wrapGitHubFetch: (fetchFn: FetchFn) => FetchFn = (f) => f,
) => {
  const providers: PullRequestProvider[] = [];
  if (hasBitbucketCredentials(env)) {
    providers.push(createBitbucketProvider({
      workspace: cfg.workspace, projectKey: cfg.projectKey, auth: `Basic ${Buffer.from(`${env.BITBUCKET_EMAIL}:${env.BITBUCKET_API_TOKEN}`).toString("base64")}`,
    }));
  }
  if (cfg.githubToken) {
    providers.push(createGitHubProvider(cfg.githubOrg, cfg.githubToken, wrapGitHubFetch(globalThis.fetch)));
  }
  return createProviderRegistry(providers);
};
