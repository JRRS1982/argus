import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config";
import { getDb } from "@/lib/db";
import { upsertBitbucketUsers, upsertBitbucketRepos } from "@/lib/db/queries";
import { getAuthHeader } from "@/lib/bitbucket/client";
import { fetchWorkspaceMembers, fetchRepos } from "@/lib/bitbucket/discover";
import { isDemoRequest } from "@/lib/demo/request";
import { createGitHubProvider } from "@/lib/github/adapter";
import { discoverProvider } from "@/lib/discovery/discover";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // The client never appends `?demo=1` to this write — the UI disables the Discover
    // button instead — so this guard is defence-in-depth, not the active protection.
    if (isDemoRequest(req.nextUrl)) {
      return NextResponse.json(
        { error: "Demo mode shows fabricated data — turn it off to discover the workspace." },
        { status: 400 },
      );
    }
    const auth = getAuthHeader();
    const [members, repos] = await Promise.all([
      fetchWorkspaceMembers(config.workspace, auth),
      fetchRepos(config.workspace, config.projectKey, auth),
    ]);
    const db = getDb();
    upsertBitbucketUsers(db, members);
    upsertBitbucketRepos(db, repos);
    // GitHub runs after Bitbucket so its repos and people have existing canonical
    // entities to link onto. Skipped when no token is configured.
    const github = config.githubToken
      ? await discoverProvider(db, createGitHubProvider(config.githubOrg, config.githubToken))
      : null;
    return NextResponse.json({ users: members.length, repos: repos.length, github });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
