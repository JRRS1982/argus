import type { Matrix } from "@/types";

export default function MatrixTable({ matrix, cornerLabel }: { matrix: Matrix; cornerLabel: string }) {
  if (matrix.rowUsers.length === 0 || matrix.colHeaders.length === 0) {
    return <p className="text-sm text-gray-500">No data yet — discover, include users/repos, then refresh.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 bg-gray-100 border px-3 py-2 text-left font-medium text-gray-700">{cornerLabel}</th>
            {matrix.colHeaders.map((c) => (
              <th key={c.key} className="border px-3 py-2 text-gray-700 font-medium whitespace-nowrap">{c.label}</th>
            ))}
            <th className="border px-3 py-2 bg-gray-100 text-gray-700 font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {matrix.rowUsers.map((u, r) => (
            <tr key={u.accountId}>
              <th className="sticky left-0 bg-white border px-3 py-2 text-left font-medium text-gray-700 whitespace-nowrap">{u.displayName}</th>
              {matrix.colHeaders.map((c, ci) => (
                <td key={c.key} className="border px-3 py-2 text-center text-gray-800">
                  {matrix.cells[r][ci] || ""}
                </td>
              ))}
              <td className="border px-3 py-2 text-center font-semibold bg-gray-50">{matrix.rowTotals[r]}</td>
            </tr>
          ))}
          <tr>
            <th className="sticky left-0 bg-gray-100 border px-3 py-2 text-left font-semibold text-gray-700">Total</th>
            {matrix.colTotals.map((t, i) => (
              <td key={i} className="border px-3 py-2 text-center font-semibold bg-gray-50">{t}</td>
            ))}
            <td className="border px-3 py-2" />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
