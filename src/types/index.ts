export type CellMetrics = {
  approved: number;
  assignedToReview: number;
};

export type MonthColumn = {
  year: number;
  month: number; // 1-indexed
  label: string; // e.g. "Feb 2025"
  key: string;   // e.g. "2025-02"
};

export type User = {
  name: string;
  bitbucketAccountId: string;
  jiraAccountId: string;
};

// reviewData[userName][monthKey] = CellMetrics
export type ReviewData = Record<string, Record<string, CellMetrics>>;

// ── Argus domain types ───────────────────────────────────────────────

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
  prCount: number;
  averageReviewMs: number;
  prs: LeaderboardPR[]; // sorted slowest-first within the row
};

export type Matrix = {
  rowUsers: { accountId: string; displayName: string }[];
  colHeaders: { key: string; label: string }[];
  cells: number[][];   // cells[rowIndex][colIndex]
  rowTotals: number[];
  colTotals: number[];
};

export type InsightsResponse = {
  leaderboard: LeaderboardRow[];
  prsCreated: Matrix;
  approvals: Matrix;
  sinceIso: string;
  generatedAt: string;
};
