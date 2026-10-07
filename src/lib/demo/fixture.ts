import type {
  ApprovalRecord, PullRequestRecord, Person, Service,
} from "@/types";
import { mulberry32, intBetween, pick } from "./random";

export type DemoDataset = {
  people: Person[];
  services: Service[];
  prs: PullRequestRecord[];
  approvals: ApprovalRecord[];
};

const SEED = 20260729;
const DAY_MS = 86_400_000;

// Invented people and services. Deliberately generic so nothing reads as a real
// colleague or a real MVF repository.
type Profile = {
  accountId: string;
  displayName: string;
  prCount: number;
  repoWeights: number[];   // relative likelihood per repo index; 0 means never
  historyDays: number;     // how far back this engineer's PRs reach
  reviewDays: [number, number]; // typical [min, max] days a PR stays open
  approvalAppetite: number; // 0..1 — how often this person approves others' PRs
};

const REPOS: { slug: string; name: string }[] = [
  { slug: "checkout-api", name: "checkout-api" },
  { slug: "identity-service", name: "identity-service" },
  { slug: "notifications-worker", name: "notifications-worker" },
  { slug: "pricing-engine", name: "pricing-engine" },
  { slug: "web-storefront", name: "web-storefront" },
];

const PROFILES: Profile[] = [
  // High-volume generalist: everywhere, fast turnaround.
  {
    accountId: "demo-1", displayName: "Ana Ferreira", prCount: 42,
    repoWeights: [3, 2, 2, 2, 3], historyDays: 400,
    reviewDays: [1, 6], approvalAppetite: 0.45,
  },
  // Specialist: almost entirely one service, slower and larger changes.
  {
    accountId: "demo-2", displayName: "Ben Okafor", prCount: 26,
    repoWeights: [0, 0, 1, 9, 0], historyDays: 380,
    reviewDays: [2, 14], approvalAppetite: 0.3,
  },
  // Prolific reviewer: fewer PRs of their own, approves a lot of everyone else's.
  {
    accountId: "demo-3", displayName: "Chloe Martin", prCount: 16,
    repoWeights: [2, 3, 1, 1, 2], historyDays: 360,
    reviewDays: [1, 4], approvalAppetite: 0.85,
  },
  // Steady mid-volume across a few services.
  {
    accountId: "demo-4", displayName: "Dev Patel", prCount: 22,
    repoWeights: [3, 1, 3, 0, 1], historyDays: 340,
    reviewDays: [2, 9], approvalAppetite: 0.5,
  },
  // Recent joiner: short history, still finding a rhythm.
  {
    accountId: "demo-5", displayName: "Emma Lindqvist", prCount: 9,
    repoWeights: [1, 1, 0, 0, 3], historyDays: 70,
    reviewDays: [1, 7], approvalAppetite: 0.25,
  },
];

const TITLES = [
  "Handle empty cart on checkout", "Retry failed webhook deliveries",
  "Cache pricing lookups for 60s", "Fix timezone drift in scheduled jobs",
  "Add structured logging to request middleware", "Tighten validation on signup payload",
  "Split oversized migration into batches", "Remove dead feature flag",
  "Backfill missing audit rows", "Reduce cold-start time on worker boot",
  "Paginate the admin search endpoint", "Correct rounding on discounted totals",
  "Guard against duplicate submissions", "Upgrade to the new auth client",
  "Document the rate-limit headers",
];

// Weighted choice over repo indices; weights of 0 are never selected.
// Invariant: every profile must have at least one non-zero repo weight, or the
// findIndex fallback below returns -1 and REPOS[-1] throws.
const pickRepoIndex = (rand: () => number, weights: number[]): number => {
  const total = weights.reduce((s, w) => s + w, 0);
  let n = rand() * total;
  for (let i = 0; i < weights.length; i += 1) {
    n -= weights[i];
    if (n < 0) return i;
  }
  return weights.findIndex((w) => w > 0);
};

export const buildDemoDataset = (nowIso: string): DemoDataset => {
  const rand = mulberry32(SEED);
  const now = new Date(nowIso).getTime();

  // Canonical ids are the 1-based position in PROFILES / REPOS, so they are stable.
  const people: Person[] = PROFILES.map((p, i) => ({
    id: i + 1, displayName: p.displayName, included: true,
    identities: [{ provider: "bitbucket", accountId: p.accountId }],
  }));
  const services: Service[] = REPOS.map((r, i) => ({
    id: i + 1, name: r.name, included: true,
    identities: [{
      provider: "bitbucket", repoKey: r.slug, defaultBranch: "main", groupKey: "DEMO",
      state: "active", lastSyncedOn: null,
    }],
  }));
  const personIdOf = (accountId: string): number =>
    PROFILES.findIndex((p) => p.accountId === accountId) + 1;

  const prs: PullRequestRecord[] = [];
  let nextId = 100;

  for (const profile of PROFILES) {
    for (let i = 0; i < profile.prCount; i += 1) {
      const repoIdx = pickRepoIndex(rand, profile.repoWeights);
      const repo = REPOS[repoIdx];
      const openDays = intBetween(rand, profile.reviewDays[0], profile.reviewDays[1]);

      // The last couple of PRs per profile are drawn so their review period has not
      // elapsed yet — age is forced strictly below the review length, guaranteeing a
      // close time after `now`. Without this, ageDays and openDays were independent
      // draws, so with SEED fixed nothing was ever open, at any instant.
      const isRecentSlot = i >= profile.prCount - Math.min(2, profile.prCount);
      const ageDays = isRecentSlot
        ? intBetween(rand, 0, Math.max(0, openDays - 1))
        : intBetween(rand, 0, profile.historyDays);
      const createdMs = now - ageDays * DAY_MS - intBetween(rand, 0, 23) * 3_600_000;
      const closedMs = createdMs + openDays * DAY_MS;

      // Anything not yet closed by `now` is still open; everything else merged.
      const isOpen = closedMs > now;
      const id = nextId;
      nextId += 1;

      prs.push({
        provider: "bitbucket",
        repoKey: repo.slug,
        number: id,
        serviceId: repoIdx + 1,
        personId: personIdOf(profile.accountId),
        title: pick(rand, TITLES),
        state: isOpen ? "OPEN" : "MERGED",
        createdOn: new Date(createdMs).toISOString(),
        // No draft→ready history in demo data, matching a `fast` sync.
        readyForReviewOn: new Date(createdMs).toISOString(),
        readyForReviewPrecision: "fallback",
        mergedOn: isOpen ? null : new Date(closedMs).toISOString(),
        mergedOnPrecision: isOpen ? null : "derived",
        destinationBranch: "main",
        url: `https://example.com/demo/${repo.slug}/pull-requests/${id}`,
      });
    }
  }

  // Approvals: each merged PR draws reviewers from the other four engineers,
  // weighted by appetite. A deliberate slice is left unapproved so the
  // "Merged, no approval" column is non-zero.
  const approvals: ApprovalRecord[] = [];
  for (const pr of prs) {
    if (pr.state !== "MERGED") continue;
    if (rand() < 0.08) continue; // merged with nobody else's approval

    const reviewers = PROFILES.filter((p) => personIdOf(p.accountId) !== pr.personId);
    let approved = 0;
    for (const reviewer of reviewers) {
      if (rand() > reviewer.approvalAppetite) continue;
      approvals.push({
        provider: "bitbucket",
        repoKey: pr.repoKey,
        prNumber: pr.number,
        approverAccountId: reviewer.accountId,
        personId: personIdOf(reviewer.accountId),
        approvedOn: pr.mergedOn,
      });
      approved += 1;
      if (approved === 2) break; // two approvals is the realistic ceiling
    }
    // Guarantee at least one approver on most merged PRs, so the grid is not sparse.
    if (approved === 0) {
      const reviewer = pick(rand, reviewers);
      approvals.push({
        provider: "bitbucket",
        repoKey: pr.repoKey,
        prNumber: pr.number,
        approverAccountId: reviewer.accountId,
        personId: personIdOf(reviewer.accountId),
        approvedOn: pr.mergedOn,
      });
    }
  }

  return { people, services, prs, approvals };
};
