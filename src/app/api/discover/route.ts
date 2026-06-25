import { NextResponse } from "next/server";
import { config } from "@/config";
import { getDb } from "@/lib/db";
import { upsertUsers, upsertRepos } from "@/lib/db/queries";
import { getAuthHeader } from "@/lib/bitbucket/client";
import { fetchWorkspaceMembers, fetchRepos } from "@/lib/bitbucket/discover";

export const runtime = "nodejs";

export async function POST() {
  try {
    const auth = getAuthHeader();
    const [members, repos] = await Promise.all([
      fetchWorkspaceMembers(config.workspace, auth),
      fetchRepos(config.workspace, config.projectKey, auth),
    ]);
    const db = getDb();
    upsertUsers(db, members);
    upsertRepos(db, repos);
    return NextResponse.json({ users: members.length, repos: repos.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
