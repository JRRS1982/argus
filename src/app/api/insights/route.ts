import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getUsers, getRepos, getPullRequests, getApprovals, getLastRefreshed } from "@/lib/db/queries";
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
    const { users, repos, prs, approvals, lastRefreshedAt } = demo
      ? { ...buildDemoDataset(generatedAtEarly), lastRefreshedAt: generatedAtEarly }
      : (() => {
          const db = getDb();
          return {
            users: getUsers(db), repos: getRepos(db),
            prs: getPullRequests(db), approvals: getApprovals(db),
            lastRefreshedAt: getLastRefreshed(db),
          };
        })();

    const generatedAt = generatedAtEarly;
    const earliestCreated = prs.reduce<string | null>(
      (min, pr) => (min === null || pr.createdOn < min ? pr.createdOn : min),
      null,
    );
    const sinceIso = resolveSinceIso(window, generatedAt, earliestCreated);

    const body: InsightsResponse = {
      leaderboard: computeLeaderboard(prs, repos, users, sinceIso),
      prsCreated: computePrsCreatedMatrix(prs, repos, users, sinceIso),
      approvals: computeApprovalMatrix(prs, approvals, repos, users, sinceIso),
      window,
      sinceIso,
      generatedAt,
      lastRefreshedAt,
    };
    return NextResponse.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
