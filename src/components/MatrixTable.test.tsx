// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import MatrixTable from "@/components/MatrixTable";
import type { Matrix } from "@/types";

const matrix: Matrix = {
  rowUsers: [{ accountId: "u1", displayName: "Alice" }],
  colHeaders: [{ key: "repo-a", label: "Repo A" }],
  cells: [[3]],
  rowTotals: [3],
  colTotals: [3],
};

// Without this, renders accumulate in the same document and text queries match across tests.
afterEach(cleanup);

describe("MatrixTable", () => {
  it("renders row labels, column headers, and cell values", () => {
    render(<MatrixTable matrix={matrix} rowAxisLabel="User" colAxisLabel="Repo" rowTotalLabel="PRs by engineer" colTotalLabel="PRs in repo" description="What this table shows." />);
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Repo A")).toBeTruthy();
    expect(screen.getAllByText("3")).toHaveLength(3);
  });

  it("labels both axes and spans the column banner over the data columns only", () => {
    const withExtra: Matrix = { ...matrix, extraColumn: { label: "Services", values: [1] } };
    const { container } = render(
      <MatrixTable matrix={withExtra} rowAxisLabel="PR author" colAxisLabel="Approver" rowTotalLabel="Approvals received" colTotalLabel="Approvals given" description="d" />,
    );
    expect(screen.getByText("Approver →")).toBeTruthy();
    expect(screen.getByText("↓ PR author")).toBeTruthy();
    // Banner covers the 1 data column, not Total or Services.
    const banner = screen.getByText("Approver →");
    expect(banner.getAttribute("colspan")).toBe("1");
    expect(container.querySelectorAll("thead tr")).toHaveLength(2);
  });

  it("names what the totals count, on both axes, instead of a bare 'Total'", () => {
    const { container } = render(
      <MatrixTable
        matrix={matrix}
        rowAxisLabel="PR author"
        colAxisLabel="Approver"
        rowTotalLabel="Approvals received"
        colTotalLabel="Approvals given"
        description="d"
      />,
    );
    expect(screen.getByText("Approvals received")).toBeTruthy(); // heads the totals column
    expect(screen.getByText("Approvals given")).toBeTruthy();    // heads the totals row
    expect(container.textContent).not.toContain("Total");
  });

  it("renders the optional extra column when present", () => {
    const withExtra: Matrix = { ...matrix, extraColumn: { label: "Services", values: [1] } };
    render(<MatrixTable matrix={withExtra} rowAxisLabel="User" colAxisLabel="Repo" rowTotalLabel="PRs by engineer" colTotalLabel="PRs in repo" description="d" />);
    expect(screen.getByText("Services")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("greys out cells where the row and column are the same person", () => {
    // Approvals shape: columns are keyed by account id, so the diagonal is self-approval.
    const approvals: Matrix = {
      rowUsers: [{ accountId: "u1", displayName: "Alice" }, { accountId: "u2", displayName: "Bob" }],
      colHeaders: [{ key: "u1", label: "Alice" }, { key: "u2", label: "Bob" }],
      cells: [[0, 4], [7, 0]],
      rowTotals: [4, 7],
      colTotals: [7, 4],
    };
    const { container } = render(
      <MatrixTable matrix={approvals} rowAxisLabel="PR author" colAxisLabel="Approver" rowTotalLabel="Approvals received" colTotalLabel="Approvals given" description="approvals" />,
    );
    const selfCells = container.querySelectorAll('td[title="Self-approval isn\'t possible"]');
    expect(selfCells).toHaveLength(2); // the two diagonal cells only
    expect(selfCells[0].className).toContain("bg-gray-200");
  });

  it("leaves the PRs-created grid ungreyed, since repo columns never match an account id", () => {
    const { container } = render(
      <MatrixTable matrix={matrix} rowAxisLabel="Engineer" colAxisLabel="Repository" rowTotalLabel="PRs by engineer" colTotalLabel="PRs in repo" description="prs created" />,
    );
    expect(container.querySelectorAll('td[title="Self-approval isn\'t possible"]')).toHaveLength(0);
  });

  it("highlights each row's top approver, and every cell in a tie", () => {
    const approvals: Matrix = {
      rowUsers: [
        { accountId: "u1", displayName: "Alice" },
        { accountId: "u2", displayName: "Bob" },
        { accountId: "u3", displayName: "Cara" },
      ],
      colHeaders: [{ key: "u1", label: "Alice" }, { key: "u2", label: "Bob" }, { key: "u3", label: "Cara" }],
      cells: [
        [0, 2, 9], // Alice's top approver is Cara
        [5, 0, 5], // Bob: tie between Alice and Cara
        [0, 0, 0], // Cara: no approvals at all -> nothing to highlight
      ],
      rowTotals: [11, 10, 0],
      colTotals: [5, 2, 14],
    };
    const { container } = render(
      <MatrixTable matrix={approvals} rowAxisLabel="PR author" colAxisLabel="Approver" rowTotalLabel="Approvals received" colTotalLabel="Approvals given" description="d" highlightRowMax />,
    );
    const highlighted = [...container.querySelectorAll("td.bg-amber-100")].map((td) => td.textContent);
    expect(highlighted).toEqual(["9", "5", "5"]); // one for Alice, both tied cells for Bob, none for Cara
  });

  it("does not highlight row maxima unless asked", () => {
    const { container } = render(
      <MatrixTable matrix={matrix} rowAxisLabel="Engineer" colAxisLabel="Repository" rowTotalLabel="PRs by engineer" colTotalLabel="PRs in repo" description="d" />,
    );
    expect(container.querySelectorAll("td.bg-amber-100")).toHaveLength(0);
  });

  it("puts totals immediately after the engineer name when asked", () => {
    const withExtra: Matrix = { ...matrix, extraColumn: { label: "Services", values: [1] } };
    const { container } = render(
      <MatrixTable
        matrix={withExtra}
        rowAxisLabel="Engineer" colAxisLabel="Repository"
        rowTotalLabel="PRs by engineer" colTotalLabel="PRs in repo"
        description="d" totalsPosition="leading"
      />,
    );
    const headers = [...container.querySelectorAll("thead tr")[1].children].map((c) => c.textContent);
    expect(headers).toEqual(["↓ Engineer", "PRs by engineer", "Services", "Repo A"]);
  });

  it("keeps totals at the end by default", () => {
    const withExtra: Matrix = { ...matrix, extraColumn: { label: "Services", values: [1] } };
    const { container } = render(
      <MatrixTable
        matrix={withExtra}
        rowAxisLabel="Engineer" colAxisLabel="Repository"
        rowTotalLabel="PRs by engineer" colTotalLabel="PRs in repo"
        description="d"
      />,
    );
    const headers = [...container.querySelectorAll("thead tr")[1].children].map((c) => c.textContent);
    expect(headers).toEqual(["↓ Engineer", "Repo A", "PRs by engineer", "Services"]);
  });

  it("aligns body cells with the leading header order", () => {
    const withExtra: Matrix = { ...matrix, extraColumn: { label: "Services", values: [1] } };
    const { container } = render(
      <MatrixTable
        matrix={withExtra}
        rowAxisLabel="Engineer" colAxisLabel="Repository"
        rowTotalLabel="PRs by engineer" colTotalLabel="PRs in repo"
        description="d" totalsPosition="leading"
      />,
    );
    const firstRow = [...container.querySelectorAll("tbody tr")[0].children].map((c) => c.textContent);
    expect(firstRow).toEqual(["Alice", "3", "1", "3"]); // name, row total, services, cell
  });

  it("gives the row-header a fixed width to match the sticky total column, only in leading mode", () => {
    const withExtra: Matrix = { ...matrix, extraColumn: { label: "Services", values: [1] } };

    const { container: leadingContainer } = render(
      <MatrixTable
        matrix={withExtra}
        rowAxisLabel="Engineer" colAxisLabel="Repository"
        rowTotalLabel="PRs by engineer" colTotalLabel="PRs in repo"
        description="d" totalsPosition="leading"
      />,
    );
    const leadingRow = leadingContainer.querySelectorAll("tbody tr")[0].children;
    expect(leadingRow[0].className).toContain("w-52"); // engineer name, sized to match the total's offset
    expect(leadingRow[1].className).toContain("left-52"); // row total, stuck at that same offset

    const { container: trailingContainer } = render(
      <MatrixTable
        matrix={withExtra}
        rowAxisLabel="Engineer" colAxisLabel="Repository"
        rowTotalLabel="PRs by engineer" colTotalLabel="PRs in repo"
        description="d"
      />,
    );
    // Approvals (and any other trailing-mode table) must render exactly as it did before this
    // prop existed: auto-width name column, nothing stuck at a fixed offset.
    const allTrailingCells = [...trailingContainer.querySelectorAll("th, td")];
    allTrailingCells.forEach((cell) => {
      expect(cell.className).not.toContain("w-52");
      expect(cell.className).not.toContain("left-52");
    });
  });

  it("shows the description alongside the empty state", () => {
    const empty: Matrix = { rowUsers: [], colHeaders: [], cells: [], rowTotals: [], colTotals: [] };
    render(<MatrixTable matrix={empty} rowAxisLabel="User" colAxisLabel="Repo" rowTotalLabel="PRs by engineer" colTotalLabel="PRs in repo" description="What this table shows." />);
    expect(screen.getByText("What this table shows.")).toBeTruthy();
    expect(screen.getByText(/No data yet/)).toBeTruthy();
  });
});
