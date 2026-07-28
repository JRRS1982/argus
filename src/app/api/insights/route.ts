import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getUsers, getRepos, getPullRequests, getApprovals } from "@/lib/db/queries";
import { computeLeaderboard } from "@/lib/analytics/leaderboard";
import { computePrsCreatedMatrix, computeApprovalMatrix } from "@/lib/analytics/matrices";
import { resolveSinceIso, isInsightsWindow, type InsightsWindow } from "@/lib/window";
import type { InsightsResponse } from "@/types";

export const runtime = "nodejs";

// Query: ?window=6m|all (default 6m). The window is only a read-time filter — the
// cache is never pruned, so "all" reports every PR ever synced.
export async function GET(req: NextRequest) {
  try {
    const requested = req.nextUrl.searchParams.get("window");
    if (requested !== null && !isInsightsWindow(requested)) {
      return NextResponse.json({ error: "Expected window=6m|all" }, { status: 400 });
    }
    const window: InsightsWindow = requested ?? "6m";

    const db = getDb();
    const users = getUsers(db);
    const repos = getRepos(db);
    const prs = getPullRequests(db);
    const approvals = getApprovals(db);

    const generatedAt = new Date().toISOString();
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
    };
    return NextResponse.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
