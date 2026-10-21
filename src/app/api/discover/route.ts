import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config";
import { getDb } from "@/lib/db";
import { isDemoRequest } from "@/lib/demo/request";
import { createGitHubProvider } from "@/lib/github/adapter";
import { discoverProvider } from "@/lib/discovery/discover";
import { createRateLimitGovernor } from "@/lib/github/rate-limit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // The client never appends `?demo=1` to this write — the UI disables the Discover
    // button instead — so this guard is defence-in-depth, not the active protection.
    if (isDemoRequest(req.nextUrl)) {
      return NextResponse.json(
        { error: "Demo mode shows fabricated data — turn it off to discover the workspace." },
        { status: 400 },
      );
    }
    // Bitbucket is a frozen archive: migration 001 already holds every one of its
    // repos and people, so re-discovering it can add nothing — and needing Bitbucket
    // credentials here would fail Discover before GitHub is ever reached.
    if (!config.githubToken) {
      return NextResponse.json(
        { error: "Nothing to discover: set GITHUB_TOKEN. Bitbucket is a read-only archive and is not re-discovered." },
        { status: 400 },
      );
    }
    const db = getDb();
    // Discover costs only a handful of requests, but it is spent from the same shared
    // allowance as everything else, so it answers to the same reserve: no path through
    // Argus may drive the user's quota below what is held back for them.
    const governor = createRateLimitGovernor({
      reserve: config.githubReserve,
      maxRequestsPerRun: config.githubMaxRequestsPerRun,
      minIntervalMs: config.githubMinRequestIntervalMs,
    });
    const provider = createGitHubProvider(
      config.githubOrg, config.githubToken, governor.wrap(globalThis.fetch),
    );
    const github = await discoverProvider(db, provider);
    return NextResponse.json({
      users: github.people, repos: github.repos, github, rateLimit: governor.status(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
