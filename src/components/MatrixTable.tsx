import type { Matrix } from "@/types";

// The largest value in a row, or null when the row has no data to lead.
// Ties return the shared value, so every tied cell is highlighted rather than an arbitrary one.
const rowLeaderValue = (row: number[]): number | null => {
  const max = row.reduce((m, n) => (n > m ? n : m), 0);
  return max > 0 ? max : null;
};

export default function MatrixTable({
  matrix, rowAxisLabel, colAxisLabel, rowTotalLabel, colTotalLabel, description,
  highlightRowMax = false, totalsPosition = "trailing",
}: {
  matrix: Matrix;
  rowAxisLabel: string;
  colAxisLabel: string;
  // What a row adds up to (heads the totals column) and what a column adds up to
  // (heads the totals row). "Total" alone leaves the reader guessing total of what.
  rowTotalLabel: string;
  colTotalLabel: string;
  description: string;
  highlightRowMax?: boolean;
  // "leading" puts the row totals next to the engineer name, where the headline
  // number belongs when the point of the table is output rather than distribution.
  totalsPosition?: "leading" | "trailing";
}) {
  const leading = totalsPosition === "leading";
  const trailingCols = matrix.extraColumn ? 2 : 1;
  // Sticky offset for the totals column must match the row-header width below.
  const stickyTotal = leading ? "sticky left-52 z-10" : "";

  const totalHeaders = (
    <>
      <th className={`border px-3 py-2 bg-gray-100 text-gray-700 font-semibold whitespace-nowrap ${stickyTotal}`}>
        {rowTotalLabel}
      </th>
      {matrix.extraColumn && (
        <th className="border px-3 py-2 bg-gray-100 text-gray-700 font-semibold whitespace-nowrap">
          {matrix.extraColumn.label}
        </th>
      )}
    </>
  );

  const totalCells = (r: number) => (
    <>
      <td className={`border px-3 py-2 text-center font-semibold bg-gray-50 ${stickyTotal}`}>
        {matrix.rowTotals[r]}
      </td>
      {matrix.extraColumn && (
        <td className="border px-3 py-2 text-center font-semibold bg-gray-50">
          {matrix.extraColumn.values[r]}
        </td>
      )}
    </>
  );

  const totalFooters = (
    <>
      <td className={`border px-3 py-2 bg-gray-100 ${stickyTotal}`} />
      {matrix.extraColumn && <td className="border px-3 py-2" />}
    </>
  );

  return (
    <section>
      <p className="text-sm text-gray-600 mb-3 max-w-4xl">{description}</p>
      {matrix.rowUsers.length === 0 || matrix.colHeaders.length === 0 ? (
        <p className="text-sm text-gray-500">No data yet — discover, include users/repos, then refresh.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              {/* Axis banner: names what the columns are, so the grid can't be read transposed. */}
              <tr>
                <th className="sticky left-0 bg-gray-100 border-0" />
                {leading && <th colSpan={trailingCols} className="border-0" />}
                <th
                  colSpan={matrix.colHeaders.length}
                  className="border px-3 py-1 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500"
                >
                  {colAxisLabel} →
                </th>
                {!leading && <th colSpan={trailingCols} className="border-0" />}
              </tr>
              <tr>
                <th className="sticky left-0 z-20 bg-gray-100 border px-3 py-2 text-left font-medium text-gray-700 whitespace-nowrap w-52">
                  ↓ {rowAxisLabel}
                </th>
                {leading && totalHeaders}
                {matrix.colHeaders.map((c) => (
                  <th key={c.key} className="border px-3 py-2 text-gray-700 font-medium whitespace-nowrap">{c.label}</th>
                ))}
                {!leading && totalHeaders}
              </tr>
            </thead>
            <tbody>
              {matrix.rowUsers.map((u, r) => {
                const leader = highlightRowMax ? rowLeaderValue(matrix.cells[r]) : null;
                return (
                <tr key={u.accountId}>
                  <th className="sticky left-0 z-20 bg-white border px-3 py-2 text-left font-medium text-gray-700 whitespace-nowrap w-52">{u.displayName}</th>
                  {leading && totalCells(r)}
                  {matrix.colHeaders.map((c, ci) => {
                    // A cell where the row and column are the same person is structurally
                    // impossible (self-approval), not merely empty — grey it out to say so.
                    // Only matches when rows and columns are both users, i.e. the approvals matrix.
                    if (c.key === u.accountId) {
                      return (
                        <td
                          key={c.key}
                          title="Self-approval isn't possible"
                          className="border px-3 py-2 text-center bg-gray-200 text-gray-400"
                        >
                          —
                        </td>
                      );
                    }
                    const value = matrix.cells[r][ci];
                    const isLeader = leader !== null && value === leader;
                    return (
                      <td
                        key={c.key}
                        title={isLeader ? `${c.label} approves the most of ${u.displayName}'s PRs` : undefined}
                        className={
                          isLeader
                            ? "border px-3 py-2 text-center bg-amber-100 font-semibold text-amber-900"
                            : "border px-3 py-2 text-center text-gray-800"
                        }
                      >
                        {value || ""}
                      </td>
                    );
                  })}
                  {!leading && totalCells(r)}
                </tr>
                );
              })}
              <tr>
                <th className="sticky left-0 z-20 bg-gray-100 border px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap w-52">
                  {colTotalLabel}
                </th>
                {leading && totalFooters}
                {matrix.colTotals.map((t, i) => (
                  <td key={i} className="border px-3 py-2 text-center font-semibold bg-gray-50">{t}</td>
                ))}
                {!leading && totalFooters}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
