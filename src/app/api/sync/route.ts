import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config";
import { getDb } from "@/lib/db";
import { getSyncableIdentities } from "@/lib/db/canonical";
import { createConfiguredRegistry } from "@/lib/providers/configured";
import { syncAll, type SyncDeps } from "@/lib/sync/sync";
import { isDemoRequest } from "@/lib/demo/request";
import {
  createRateLimitGovernor, fetchRateLimit, describeExhausted,
} from "@/lib/github/rate-limit";

export const runtime = "nodejs";

// Body: { mode?: "fast" | "deep", backfill?: boolean }. Mode only affects providers
// whose summary is enough (Bitbucket, which is archived and never fetched); GitHub
// always syncs at full detail because its PR list carries no reviews. backfill: true
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
    const mode: "fast" | "deep" = requested ?? "fast";
    const backfill = body?.backfill;
    if (backfill !== undefined && typeof backfill !== "boolean") {
      return NextResponse.json({ error: "Expected { backfill?: boolean }" }, { status: 400 });
    }

    const db = getDb();
    // Argus shares the user's GitHub token, so the run is bounded before it starts:
    // it leaves `githubReserve` requests untouched, spends at most
    // `githubMaxRequestsPerRun`, and paces what it does send.
    const governor = createRateLimitGovernor({
      reserve: config.githubReserve,
      maxRequestsPerRun: config.githubMaxRequestsPerRun,
      minIntervalMs: config.githubMinRequestIntervalMs,
    });
    const registry = createConfiguredRegistry(config, process.env, governor.wrap);
    const providers = Object.fromEntries(registry.all().map((p) => [p.id, p]));
    const identities = getSyncableIdentities(db);
    // Archived identities (all of Bitbucket) are never fetched, and an identity whose
    // provider has no credentials cannot be. Neither is an error, but with nothing
    // left to fetch the user needs telling why.
    const fetchable = identities.filter((i) => i.state === "active" && providers[i.provider]);
    if (fetchable.length === 0) {
      return NextResponse.json(
        { error: "Nothing to refresh. Run Discover, tick the repositories to pull data from, and make sure GITHUB_TOKEN is set; Bitbucket is a read-only archive and is not refreshed." },
        { status: 400 },
      );
    }
    // /rate_limit is free, so asking first costs nothing and turns "every repo failed"
    // into a plain answer about quota. A preflight that itself fails is not fatal: the
    // first real response reports the same figures, and sync explains any credential
    // problem better than this would.
    if (config.githubToken && fetchable.some((i) => i.provider === "github")) {
      const status = await fetchRateLimit(config.githubToken).catch(() => null);
      if (status) {
        governor.seed(status);
        if (status.remaining !== null && status.remaining <= config.githubReserve) {
          return NextResponse.json(
            { error: describeExhausted(status, config.githubReserve), rateLimit: governor.status() },
            { status: 429 },
          );
        }
      }
    }

    // Unconfigured providers drop out here; archived identities stay in so sync can
    // tell whether a skipped repo's service is entirely gone.
    const deps: SyncDeps = {
      db, providers,
      detail: mode === "deep" ? "full" : "summary",
      backfill: backfill ?? false,
    };
    const summary = await syncAll(
      deps, identities.filter((i) => i.state !== "active" || providers[i.provider]),
      new Date().toISOString(),
    );
    // A run where every repo failed is a failure, not a sync of zero PRs — most
    // likely bad credentials, so say so rather than reporting cheerful emptiness.
    // A partial run is a success that carries warnings: the caller gets 200 plus
    // `skipped`, and the Team tab lists what was left behind. A run cut short by a
    // rate limit after some repos finished is the same: 200, with `stoppedEarly` so the
    // UI can say "run it again" instead of presenting it as a fault.
    if (summary.repos.length === 0) {
      return NextResponse.json(
        {
          ...summary, mode, backfill: backfill ?? false, rateLimit: governor.status(),
          error: `None of the ${fetchable.length} selected repositories could be refreshed. `
            + `${summary.skipped[0]?.repoKey ?? "no repository"}: `
            + `${summary.skipped[0]?.reason ?? "no reason reported"}`,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ...summary, mode, backfill: backfill ?? false, rateLimit: governor.status(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
