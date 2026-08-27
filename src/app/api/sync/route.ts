import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config";
import { getDb } from "@/lib/db";
import { getRepos } from "@/lib/db/queries";
import { getAuthHeader } from "@/lib/bitbucket/client";
import { fetchPullRequestsUpdatedSince, fetchPullRequestActivity } from "@/lib/bitbucket/pulls";
import { syncAll, type SyncDeps, type SyncMode } from "@/lib/sync/sync";
import { isDemoRequest } from "@/lib/demo/request";

export const runtime = "nodejs";

// Body: { mode?: "fast" | "deep", backfill?: boolean }. Mode defaults to "fast" —
// it populates both matrices at roughly 1 request per 50 PRs. Use "deep" for
// accurate ready-for-review times, at the cost of 1 request per PR. backfill: true
// ignores each repo's incremental cursor and fetches its entire PR history — the
// only way "All time" becomes complete, since a normal first sync reaches back
// just 6 months.
export async function POST(req: NextRequest) {
  try {
    // The client never appends `?demo=1` to this write — the UI disables the Refresh
    // button instead — so this guard is defence-in-depth, not the active protection.
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
    const backfill = body?.backfill;
    if (backfill !== undefined && typeof backfill !== "boolean") {
      return NextResponse.json({ error: "Expected { backfill?: boolean }" }, { status: 400 });
    }

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
      backfill: backfill ?? false,
    };
    const summary = await syncAll(deps, includedRepos, new Date().toISOString());
    // A run where every repo failed is a failure, not a sync of zero PRs — most
    // likely bad credentials, so say so rather than reporting cheerful emptiness.
    // A partial run is a success that carries warnings: the caller gets 200 plus
    // `skipped`, and the Team tab lists what was left behind.
    if (summary.repos.length === 0) {
      return NextResponse.json(
        {
          ...summary, mode, backfill: backfill ?? false,
          error: `None of the ${includedRepos.length} selected repositories could be refreshed. `
            + `${summary.skipped[0]?.repoSlug ?? "no repository"}: `
            + `${summary.skipped[0]?.reason ?? "no reason reported"}`,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ ...summary, mode, backfill: backfill ?? false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
