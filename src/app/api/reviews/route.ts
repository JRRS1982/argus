import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config";
import { fetchUserMonthlyMetrics } from "@/lib/bitbucket";
import { getLastNMonthColumns } from "@/lib/dates";
import type { ReviewData } from "@/types";

export type ReviewsResponse = {
  data: ReviewData;
  fetchedAt: string;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const months: number = body.months ?? 3;

  const monthColumns = getLastNMonthColumns(months);
  const monthParams = monthColumns.map(({ year, month }) => ({ year, month }));

  const { workspace, repos } = config.bitbucket;

  if (!workspace || repos.length === 0) {
    return NextResponse.json(
      { error: "Bitbucket workspace or repos not configured. See src/config/index.ts." },
      { status: 500 }
    );
  }

  try {
    const data: ReviewData = {};
    await Promise.all(
      config.users.map(async (user) => {
        if (!user.bitbucketAccountId) {
          data[user.name] = {};
          return;
        }
        data[user.name] = await fetchUserMonthlyMetrics(
          user.bitbucketAccountId,
          workspace,
          repos,
          monthParams
        );
      })
    );

    const response: ReviewsResponse = { data, fetchedAt: new Date().toISOString() };
    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
