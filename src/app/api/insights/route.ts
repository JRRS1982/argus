import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getUsers, getRepos, getPullRequests, getApprovals } from "@/lib/db/queries";
import { computeLeaderboard } from "@/lib/analytics/leaderboard";
import { computePrsCreatedMatrix, computeApprovalMatrix } from "@/lib/analytics/matrices";
import { sixMonthsAgoIso } from "@/lib/window";
import type { InsightsResponse } from "@/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const db = getDb();
    const users = getUsers(db);
    const repos = getRepos(db);
    const prs = getPullRequests(db);
    const approvals = getApprovals(db);

    const generatedAt = new Date().toISOString();
    const sinceIso = sixMonthsAgoIso(generatedAt);

    const body: InsightsResponse = {
      leaderboard: computeLeaderboard(prs, repos, users, sinceIso),
      prsCreated: computePrsCreatedMatrix(prs, repos, users, sinceIso),
      approvals: computeApprovalMatrix(prs, approvals, users, sinceIso),
      sinceIso,
      generatedAt,
    };
    return NextResponse.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
