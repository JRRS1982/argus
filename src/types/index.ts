import type { InsightsWindow } from "@/lib/window";

// DECLINED and SUPERSEDED both mean abandoned work, so they collapse to CLOSED at the
// provider boundary: nothing downstream distinguishes them, and a second provider
// would otherwise need its own vocabulary.
export type PullRequestState = "OPEN" | "MERGED" | "CLOSED";

export type PullRequestRecord = {
  provider: ProviderId;
  repoKey: string;         // the provider's repo identifier — unique only within a provider
  number: number;          // unique only within its repo
  serviceId: number;       // canonical service the repo belongs to
  personId: number;        // canonical person who authored it
  // The provider's own account id for the author. Null only for rows stored before the
  // column existed and never re-synced; it is what lets an un-merge tell two identities
  // of the same person apart, which the canonical person id alone cannot.
  authorAccountId: string | null;
  title: string;
  state: PullRequestState;
  createdOn: string;       // ISO
  readyForReviewOn: string; // ISO; equals createdOn when no draft transition found
  readyForReviewPrecision: Precision; // "fallback" when readyForReviewOn fell back to createdOn
  mergedOn: string | null; // ISO or null
  mergedOnPrecision: Precision | null;
  destinationBranch: string;
  url: string;
};

export type ApprovalRecord = {
  provider: ProviderId;
  repoKey: string;
  prNumber: number;
  approverAccountId: string;
  personId: number;
  approvedOn: string | null; // ISO; null if the API omitted a timestamp
};

// A repo a sync could not read at all. `missing` distinguishes a repo that has been
// deleted or hidden from the token (permanent — the roster entry is stale and worth
// removing) from a transient failure like a 503 or a dropped socket, which must never
// invite the user to drop a repo they still want.
export type SkippedRepo = {
  provider: ProviderId;
  repoKey: string;
  reason: string;
  status: number | null;
  missing: boolean;
};

// ── View models ──────────────────────────────────────────────────────

export type LeaderboardPR = {
  number: number;
  repoKey: string;
  title: string;
  url: string;
  reviewMs: number;
  provider: ProviderId;
  // Carried per PR so the UI can say what each figure rests on, rather than printing a
  // blanket caveat that is true of one provider and false of the other.
  readyForReviewPrecision: Precision; // "fallback" => start is creation time
  mergedOnPrecision: Precision;       // "derived" => end is last-touched, not a real merge time
};

export type LeaderboardRow = {
  personId: number;
  displayName: string;
  prCount: number;      // merged PRs with a measured duration
  openPrCount: number;  // still-open PRs; merged + open reconciles with the PRs-created tab
  averageReviewMs: number;
  medianReviewMs: number;
  prs: LeaderboardPR[]; // sorted slowest-first within the row
};

export type Matrix = {
  rowUsers: { personId: number; displayName: string }[];
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
  // When each provider last synced, one entry per provider that has data (none until
  // a first sync). Bitbucket is a frozen archive, so its stamp never moves again while
  // GitHub's does; they are kept apart so the UI can say so. Demo data is generated per
  // request, so it is one "demo" entry stamped generatedAt.
  refreshedAt: RefreshStamp[];
};

export type RefreshStamp = {
  provider: ProviderId | "demo";
  lastSyncedOn: string;
  archived: boolean;
};

export type Precision = "exact" | "derived" | "fallback";
export type ProviderId = "bitbucket" | "github";
export type IdentityState = "active" | "archived" | "missing";

export type PersonIdentity = { provider: ProviderId; accountId: string };
export type Person = { id: number; displayName: string; included: boolean; identities: PersonIdentity[] };

export type ServiceIdentity = {
  provider: ProviderId; repoKey: string; defaultBranch: string;
  groupKey: string | null; state: IdentityState; lastSyncedOn: string | null;
};
export type Service = { id: number; name: string; included: boolean; identities: ServiceIdentity[] };
