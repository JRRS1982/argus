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
