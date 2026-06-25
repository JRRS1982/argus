"use client";

import { useState } from "react";
import type { LeaderboardRow } from "@/types";

const fmtDuration = (ms: number): string => {
  const hours = ms / 3_600_000;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
};

export default function LeaderboardTab({ rows }: { rows: LeaderboardRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (rows.length === 0) return <p className="text-sm text-gray-500">No merged PRs in the window yet.</p>;

  return (
    <table className="border-collapse text-sm w-full max-w-2xl">
      <thead>
        <tr className="text-left text-gray-700">
          <th className="border px-3 py-2">#</th>
          <th className="border px-3 py-2">Engineer</th>
          <th className="border px-3 py-2">Avg review time</th>
          <th className="border px-3 py-2">PRs</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <FragmentRow
            key={row.accountId}
            row={row}
            rank={i + 1}
            isOpen={open === row.accountId}
            onToggle={() => setOpen(open === row.accountId ? null : row.accountId)}
          />
        ))}
      </tbody>
    </table>
  );
}

function FragmentRow({
  row, rank, isOpen, onToggle,
}: { row: LeaderboardRow; rank: number; isOpen: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-gray-50" onClick={onToggle}>
        <td className="border px-3 py-2">{rank}</td>
        <td className="border px-3 py-2 font-medium text-gray-800">{isOpen ? "▾" : "▸"} {row.displayName}</td>
        <td className="border px-3 py-2">{fmtDuration(row.averageReviewMs)}</td>
        <td className="border px-3 py-2">{row.prCount}</td>
      </tr>
      {isOpen && (
        <tr>
          <td className="border px-3 py-2 bg-gray-50" colSpan={4}>
            <ul className="space-y-1">
              {row.prs.map((pr) => (
                <li key={`${pr.repoSlug}#${pr.id}`} className="flex justify-between gap-4">
                  <a className="text-blue-600 hover:underline truncate" href={pr.url} target="_blank" rel="noreferrer">
                    {pr.repoSlug} #{pr.id} — {pr.title}
                  </a>
                  <span className="whitespace-nowrap text-gray-700">
                    {fmtDuration(pr.reviewMs)}{pr.readyIsFallback ? " *" : ""}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-gray-500">* draft transition unknown — measured from PR creation.</p>
          </td>
        </tr>
      )}
    </>
  );
}
