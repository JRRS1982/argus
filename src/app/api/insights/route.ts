import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getPullRequests, getApprovals } from "@/lib/db/queries";
import { getPeople, getServices, getLastRefreshedByProvider } from "@/lib/db/canonical";
import { computeLeaderboard } from "@/lib/analytics/leaderboard";
import { computePrsCreatedMatrix, computeApprovalMatrix } from "@/lib/analytics/matrices";
import { resolveSinceIso, isInsightsWindow, type InsightsWindow } from "@/lib/window";
import { isDemoRequest } from "@/lib/demo/request";
import { buildDemoDataset } from "@/lib/demo/fixture";
import type { InsightsResponse } from "@/types";

export const runtime = "nodejs";

// Query: ?window=30d|6m|all (default 6m). The window is only a read-time filter — the
// cache is never pruned, so "all" reports every PR ever synced.
export async function GET(req: NextRequest) {
  try {
    const requested = req.nextUrl.searchParams.get("window");
    if (requested !== null && !isInsightsWindow(requested)) {
      return NextResponse.json({ error: "Expected window=30d|6m|all" }, { status: 400 });
    }
    const window: InsightsWindow = requested ?? "6m";

    // The demo path must not touch SQLite: Vercel's filesystem is read-only, so
    // opening the database there fails. Same records, same analytics — only the
    // source differs.
    const demo = isDemoRequest(req.nextUrl);
    const generatedAtEarly = new Date().toISOString();
    const { people, services, prs, approvals, refreshedAt } = demo
      ? { ...buildDemoDataset(generatedAtEarly), refreshedAt: [{ provider: "demo" as const, lastSyncedOn: generatedAtEarly, archived: false }] }
      : (() => {
          const db = getDb();
          return {
            people: getPeople(db), services: getServices(db),
            prs: getPullRequests(db), approvals: getApprovals(db),
            // Per provider, so the card can tell a live stamp from a frozen archive's.
            refreshedAt: getLastRefreshedByProvider(db),
          };
        })();

    const generatedAt = generatedAtEarly;
    const earliestCreated = prs.reduce<string | null>(
      (min, pr) => (min === null || pr.createdOn < min ? pr.createdOn : min),
      null,
    );
    const sinceIso = resolveSinceIso(window, generatedAt, earliestCreated);

    const body: InsightsResponse = {
      leaderboard: computeLeaderboard(prs, services, people, sinceIso),
      prsCreated: computePrsCreatedMatrix(prs, services, people, sinceIso),
      approvals: computeApprovalMatrix(prs, approvals, services, people, sinceIso),
      window,
      sinceIso,
      generatedAt,
      refreshedAt,
    };
    return NextResponse.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
