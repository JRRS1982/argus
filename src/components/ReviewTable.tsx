"use client";

import type { MonthColumn, ReviewData } from "@/types";

const MIN_COLUMNS = 3;

type ReviewTableProps = {
  columns: MonthColumn[];
  data: ReviewData;
  users: string[];
  onAddColumn: () => void;
  onRemoveColumn: (key: string) => void;
};

export default function ReviewTable({
  columns,
  data,
  users,
  onAddColumn,
  onRemoveColumn,
}: ReviewTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border border-gray-200 text-sm">
        <thead>
          <tr className="bg-gray-50">
            <th className="sticky left-0 bg-gray-50 px-4 py-3 text-left font-semibold text-gray-700 border-b border-r border-gray-200 min-w-[140px]">
              Engineer
            </th>
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-4 py-3 text-center font-semibold text-gray-700 border-b border-r border-gray-200 min-w-[110px]"
              >
                <div className="flex flex-col items-center gap-1">
                  <span>{col.label}</span>
                  {columns.length > MIN_COLUMNS && (
                    <button
                      onClick={() => onRemoveColumn(col.key)}
                      className="text-xs text-gray-400 hover:text-red-500 transition-colors leading-none"
                      title={`Remove ${col.label}`}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </th>
            ))}
            <th className="px-3 py-3 border-b border-gray-200">
              <button
                onClick={onAddColumn}
                className="text-blue-500 hover:text-blue-700 font-medium text-sm transition-colors"
                title="Add earlier month"
              >
                + month
              </button>
            </th>
          </tr>
          <tr className="bg-gray-50 text-xs text-gray-500">
            <td className="sticky left-0 bg-gray-50 px-4 py-1 border-b border-r border-gray-200" />
            {columns.map((col) => (
              <td key={col.key} className="px-4 py-1 border-b border-r border-gray-200 text-center">
                <span className="inline-flex gap-3 justify-center w-full">
                  <span title="Approved">✓ appr</span>
                  <span title="Assigned to review">👁 asgn</span>
                </span>
              </td>
            ))}
            <td className="border-b border-gray-200" />
          </tr>
        </thead>
        <tbody>
          {users.map((userName) => (
            <tr key={userName} className="hover:bg-gray-50 transition-colors">
              <td className="sticky left-0 bg-white px-4 py-3 font-medium text-gray-800 border-b border-r border-gray-200">
                {userName}
              </td>
              {columns.map((col) => {
                const metrics = data[userName]?.[col.key];
                return (
                  <td
                    key={col.key}
                    className="px-4 py-3 text-center border-b border-r border-gray-200 tabular-nums"
                  >
                    {metrics ? (
                      <span className="inline-flex gap-4 justify-center w-full">
                        <span className="text-green-700 font-medium" title="Approved">
                          ✓ {metrics.approved}
                        </span>
                        <span className="text-blue-700" title="Assigned to review">
                          👁 {metrics.assignedToReview}
                        </span>
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                );
              })}
              <td className="border-b border-gray-200" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
