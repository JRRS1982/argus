// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import LeaderboardTab from "@/components/LeaderboardTab";
import type { LeaderboardRow, LeaderboardPR } from "@/types";

const rows: LeaderboardRow[] = [
  {
    personId: 1,
    displayName: "Alice",
    prCount: 2,
    openPrCount: 1,
    averageReviewMs: 9_000_000,
    medianReviewMs: 7_200_000,
    prs: [
      {
        number: 1, repoKey: "repo-a", title: "Fast one", url: "https://example.com/1",
        reviewMs: 3_600_000, provider: "bitbucket", readyForReviewPrecision: "derived", mergedOnPrecision: "derived",
      },
      {
        number: 2, repoKey: "repo-a", title: "Slow one", url: "https://example.com/2",
        reviewMs: 10_800_000, provider: "bitbucket", readyForReviewPrecision: "fallback", mergedOnPrecision: "derived",
      },
    ],
  },
];

// Without this, renders accumulate in the same document and text queries match across tests.
afterEach(cleanup);

describe("LeaderboardTab", () => {
  it("renders the five headers in order, with no rank column", () => {
    const { container } = render(<LeaderboardTab rows={rows} />);
    const headers = [...container.querySelectorAll("thead tr th")].map((th) => th.textContent);
    expect(headers).toEqual([
      "Engineer",
      "Median review time",
      "Avg review time",
      "Merged",
      "Open",
    ]);
  });

  it("collapses the per-PR detail row by default", () => {
    render(<LeaderboardTab rows={rows} />);
    expect(screen.queryByText(/Fast one/)).toBeNull();
  });

  it("expands to a detail row whose colspan matches the header count, after a click", () => {
    const { container } = render(<LeaderboardTab rows={rows} />);
    const headerCount = container.querySelectorAll("thead tr th").length;

    fireEvent.click(screen.getByText(/Alice/));

    expect(screen.getByText(/Fast one/)).toBeTruthy();
    const detailCell = container.querySelector("tbody tr:nth-child(2) td[colspan]");
    expect(detailCell).not.toBeNull();
    expect(Number(detailCell!.getAttribute("colspan"))).toBe(headerCount);
  });

  // Local helpers for the per-row precision tests.
  const pr = (over: Partial<LeaderboardPR> = {}): LeaderboardPR => ({
    number: 1, provider: "github", repoKey: "repo-a", title: "PR",
    url: "https://x/1", reviewMs: 3_600_000,
    readyForReviewPrecision: "exact", mergedOnPrecision: "exact", ...over,
  });
  const row = (over: Partial<LeaderboardRow> = {}): LeaderboardRow => ({
    personId: 1, displayName: "Alice", prCount: 1, openPrCount: 0,
    averageReviewMs: 3_600_000, medianReviewMs: 3_600_000, prs: [pr()], ...over,
  });

  it("flags only rows whose ready time fell back to creation", () => {
    render(<LeaderboardTab rows={[row({ prs: [
      pr({ number: 1, readyForReviewPrecision: "exact" }),
      pr({ number: 2, readyForReviewPrecision: "fallback" }),
    ] })]} />);
    fireEvent.click(screen.getByText(/Alice/));
    expect(screen.getByTestId("pr-1").textContent).not.toContain("*");
    expect(screen.getByTestId("pr-2").textContent).toContain("*");
  });

  it("drops the created-to-last-touched caveat when every row has an exact merge time", () => {
    render(<LeaderboardTab rows={[row({ prs: [pr({ mergedOnPrecision: "exact" })] })]} />);
    // Printing it would be a lie for GitHub rows, which carry a real merged_at.
    expect(screen.queryByText(/created → last touched/i)).toBeNull();
  });

  it("keeps the caveat while any row still uses a derived merge time", () => {
    render(<LeaderboardTab rows={[row({ prs: [
      pr({ mergedOnPrecision: "exact" }), pr({ mergedOnPrecision: "derived" }),
    ] })]} />);
    expect(screen.getByText(/created → last touched/i)).toBeTruthy();
  });

  it("omits the footnote for an expanded row with no fallback PRs", () => {
    render(<LeaderboardTab rows={[row()]} />);
    fireEvent.click(screen.getByText(/Alice/));
    expect(screen.queryByText(/draft transition unknown/)).toBeNull();
  });

  it("says all N PRs use creation time when nothing has draft history (the Bitbucket day-one state)", () => {
    render(<LeaderboardTab rows={[row({ prs: [
      pr({ number: 1, readyForReviewPrecision: "fallback", mergedOnPrecision: "derived" }),
      pr({ number: 2, readyForReviewPrecision: "fallback", mergedOnPrecision: "derived" }),
    ] })]} />);
    expect(screen.getByText(/Right now all 2 PRs use creation time — no draft→ready history has been synced\./)).toBeTruthy();
    // Every row is derived, so there is no recorded-merge-time PR to describe.
    expect(screen.queryByText(/PRs with a recorded merge time use that instead/)).toBeNull();
  });

  it("says X of N PRs use creation time for a mixed set, and mentions recorded merge times", () => {
    render(<LeaderboardTab rows={[row({ prs: [
      pr({ number: 1, readyForReviewPrecision: "fallback", mergedOnPrecision: "derived" }),
      pr({ number: 2, readyForReviewPrecision: "exact", mergedOnPrecision: "exact" }),
      pr({ number: 3, readyForReviewPrecision: "exact", mergedOnPrecision: "exact" }),
    ] })]} />);
    expect(screen.getByText(/Right now 1 of 3 PRs use creation time\./)).toBeTruthy();
    expect(screen.getByText(/PRs with a recorded merge time use that instead/)).toBeTruthy();
  });

  it("makes no claim about PRs when the window is empty", () => {
    render(<LeaderboardTab rows={[]} />);
    expect(screen.queryByText(/recorded merge time/)).toBeNull();
    expect(screen.queryByText(/for every PR/)).toBeNull();
    expect(screen.queryByText(/Right now/)).toBeNull();
  });
});
