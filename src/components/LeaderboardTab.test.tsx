// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import LeaderboardTab from "@/components/LeaderboardTab";
import type { LeaderboardRow } from "@/types";

const rows: LeaderboardRow[] = [
  {
    accountId: "u1",
    displayName: "Alice",
    prCount: 2,
    openPrCount: 1,
    averageReviewMs: 9_000_000,
    medianReviewMs: 7_200_000,
    prs: [
      {
        id: 1, repoSlug: "repo-a", title: "Fast one", url: "https://example.com/1",
        reviewMs: 3_600_000, readyIsFallback: false,
      },
      {
        id: 2, repoSlug: "repo-a", title: "Slow one", url: "https://example.com/2",
        reviewMs: 10_800_000, readyIsFallback: true,
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
});
