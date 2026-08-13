import type { InsightsWindow } from "@/lib/window";

export type PullRequestState = "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED";

export type PullRequestRecord = {
  id: number;              // Bitbucket PR id — unique only within its repo
  repoSlug: string;
  authorAccountId: string;
  title: string;
  state: PullRequestState;
  createdOn: string;       // ISO
  readyForReviewOn: string; // ISO; equals createdOn when no draft transition found
  readyIsFallback: boolean; // true when readyForReviewOn fell back to createdOn
  mergedOn: string | null; // ISO or null
  destinationBranch: string;
  url: string;
};

export type ApprovalRecord = {
  repoSlug: string;
  prId: number;
  approverAccountId: string;
  approvedOn: string | null; // ISO; null if the API omitted a timestamp
};

export type UserRecord = {
  accountId: string;
  displayName: string;
  included: boolean;
};

export type RepoRecord = {
  slug: string;
  name: string;
  projectKey: string | null;
  mainBranch: string;
  included: boolean;
};

// ── View models ──────────────────────────────────────────────────────

export type LeaderboardPR = {
  id: number;
  repoSlug: string;
  title: string;
  url: string;
  reviewMs: number;
  readyIsFallback: boolean;
};

export type LeaderboardRow = {
  accountId: string;
  displayName: string;
  prCount: number;      // merged PRs with a measured duration
  openPrCount: number;  // still-open PRs; merged + open reconciles with the PRs-created tab
  averageReviewMs: number;
  medianReviewMs: number;
  prs: LeaderboardPR[]; // sorted slowest-first within the row
};

export type Matrix = {
  rowUsers: { accountId: string; displayName: string }[];
  colHeaders: { key: string; label: string }[];
  cells: number[][];   // cells[rowIndex][colIndex]
  rowTotals: number[];
  colTotals: number[];
  // Optional per-row summary rendered after the Total column (e.g. distinct services touched).
  extraColumn?: { label: string; values: number[] };
};

export type InsightsResponse = {
  leaderboard: LeaderboardRow[];
  prsCreated: Matrix;
  approvals: Matrix;
  window: InsightsWindow;
  sinceIso: string;
  generatedAt: string;
  // Newest sync stamp among included repos — when the cache was last refreshed.
  // Null until a first sync; in demo mode the data is generated per request, so
  // this is simply generatedAt.
  lastRefreshedAt: string | null;
};
