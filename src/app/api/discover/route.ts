import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config";
import { getDb } from "@/lib/db";
import { upsertUsers, upsertRepos } from "@/lib/db/queries";
import { getAuthHeader } from "@/lib/bitbucket/client";
import { fetchWorkspaceMembers, fetchRepos } from "@/lib/bitbucket/discover";
import { isDemoRequest } from "@/lib/demo/request";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
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
    upsertUsers(db, members);
    upsertRepos(db, repos);
    return NextResponse.json({ users: members.length, repos: repos.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
