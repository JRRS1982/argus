import { NextResponse } from "next/server";
import { config } from "@/config";
import { getDb } from "@/lib/db";
import { getRepos } from "@/lib/db/queries";
import { getAuthHeader } from "@/lib/bitbucket/client";
import { fetchPullRequestsUpdatedSince, fetchPullRequestActivity } from "@/lib/bitbucket/pulls";
import { syncAll, type SyncDeps } from "@/lib/sync/sync";

export const runtime = "nodejs";

export async function POST() {
  try {
    const auth = getAuthHeader();
    const db = getDb();
    const includedRepos = getRepos(db).filter((r) => r.included).map((r) => r.slug);
    if (includedRepos.length === 0) {
      return NextResponse.json({ error: "No repos selected. Run Discover and include some repos first." }, { status: 400 });
    }
    const deps: SyncDeps = {
      db, workspace: config.workspace, auth,
      fetchPRs: fetchPullRequestsUpdatedSince,
      fetchActivity: fetchPullRequestActivity,
    };
    const summary = await syncAll(deps, includedRepos, new Date().toISOString());
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
