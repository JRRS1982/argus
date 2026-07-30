import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config";
import { getDb } from "@/lib/db";
import { getRepos } from "@/lib/db/queries";
import { getAuthHeader } from "@/lib/bitbucket/client";
import { fetchPullRequestsUpdatedSince, fetchPullRequestActivity } from "@/lib/bitbucket/pulls";
import { syncAll, type SyncDeps, type SyncMode } from "@/lib/sync/sync";
import { isDemoRequest } from "@/lib/demo/request";

export const runtime = "nodejs";

// Body: { mode?: "fast" | "deep" }. Defaults to "fast" — it populates both
// matrices at roughly 1 request per 50 PRs. Use "deep" for accurate
// ready-for-review times, at the cost of 1 request per PR.
export async function POST(req: NextRequest) {
  try {
    if (isDemoRequest(req.nextUrl)) {
      return NextResponse.json(
        { error: "Demo mode shows fabricated data — turn it off to sync real PRs." },
        { status: 400 },
      );
    }
    const body = await req.json().catch(() => null);
    const requested = body?.mode;
    if (requested !== undefined && requested !== "fast" && requested !== "deep") {
      return NextResponse.json({ error: "Expected { mode?: 'fast'|'deep' }" }, { status: 400 });
    }
    const mode: SyncMode = requested ?? "fast";

    const auth = getAuthHeader();
    const db = getDb();
    const includedRepos = getRepos(db).filter((r) => r.included).map((r) => r.slug);
    if (includedRepos.length === 0) {
      return NextResponse.json(
        { error: "No repositories selected. Run Discover, then tick the repositories to pull data from." },
        { status: 400 },
      );
    }
    const deps: SyncDeps = {
      db, workspace: config.workspace, auth,
      fetchPRs: fetchPullRequestsUpdatedSince,
      fetchActivity: fetchPullRequestActivity,
      mode,
    };
    const summary = await syncAll(deps, includedRepos, new Date().toISOString());
    return NextResponse.json({ ...summary, mode });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
