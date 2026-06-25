// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MatrixTable from "@/components/MatrixTable";
import type { Matrix } from "@/types";

const matrix: Matrix = {
  rowUsers: [{ accountId: "u1", displayName: "Alice" }],
  colHeaders: [{ key: "repo-a", label: "Repo A" }],
  cells: [[3]],
  rowTotals: [3],
  colTotals: [3],
};

describe("MatrixTable", () => {
  it("renders row labels, column headers, and cell values", () => {
    render(<MatrixTable matrix={matrix} cornerLabel="User \\ Repo" />);
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Repo A")).toBeTruthy();
    expect(screen.getAllByText("3")).toHaveLength(3);
  });
});
