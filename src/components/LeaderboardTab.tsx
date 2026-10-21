"use client";

import { useState } from "react";
import type { LeaderboardRow } from "@/types";

const fmtDuration = (ms: number): string => {
  const hours = ms / 3_600_000;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
};

export default function LeaderboardTab({ rows }: { rows: LeaderboardRow[] }) {
  const [open, setOpen] = useState<number | null>(null);
  // Derived from the rows on screen, so the explanation changes with the window and data
  // source: the caveats are true of Bitbucket rows and false of GitHub rows.
  const allPrs = rows.flatMap((r) => r.prs);
  const totalPrs = allPrs.length;
  const fallbackPrs = allPrs.filter((p) => p.readyForReviewPrecision === "fallback").length;
  const anyDerivedMerge = allPrs.some((p) => p.mergedOnPrecision === "derived");
  const anyExactMerge = allPrs.some((p) => p.mergedOnPrecision === "exact");

  return (
    <section>
      <div className="text-sm text-gray-600 mb-3 max-w-4xl space-y-2">
        <p>
          How long each engineer&apos;s work stays in review before it lands, across PRs merged to main inside the
          window above. Listed alphabetically — this is a record of what everyone shipped, not a race. Median is the
          figure to trust, since a couple of long-lived PRs cannot skew it; the average sits alongside for
          comparison. Click a row to see that engineer&apos;s individual PRs, listed slowest first so the longest
          reviews are easiest to spot.
        </p>
        <p className="text-gray-500">
          <span className="font-medium text-gray-700">What is actually measured:</span>{" "}
          {anyDerivedMerge ? (
            <>
              <span className="font-medium">created → last touched</span>. For some PRs the provider does not expose a
              merge timestamp, so the end of the interval is the PR&apos;s last activity — the merge for almost all
              of them, but later if someone commented after it merged.{" "}
              {anyExactMerge && "PRs with a recorded merge time use that instead. "}
            </>
          ) : totalPrs > 0 ? (
            <>Each PR is measured to its recorded merge time. </>
          ) : null}
          {totalPrs === 0 ? null : fallbackPrs === 0 ? (
            <>The start is the recorded draft→ready transition for every PR. </>
          ) : (
            <>
              The start is the draft→ready transition where one was recorded, otherwise the creation time (those PRs
              are flagged <span className="font-mono">*</span> in the expanded list).{" "}
              {fallbackPrs === totalPrs
                ? `Right now all ${totalPrs} PRs use creation time — no draft→ready history has been synced.`
                : `Right now ${fallbackPrs} of ${totalPrs} PRs use creation time.`}{" "}
            </>
          )}
          The window is applied to the end of the interval, so a PR opened long before it still counts.
        </p>
        <p className="text-gray-500">
          <span className="font-medium text-gray-700">Reconciling with PRs created:</span> on{" "}
          <span className="font-medium">All time</span>, Merged + Open here equals that engineer&apos;s row total on
          the PRs created tab — both tabs count the same population (merged or open, targeting the repo&apos;s main
          branch, in an included repo). On a 6-month view the two differ on purpose: this tab windows on when a PR
          landed, PRs created windows on when it was opened. Engineers with no merged PRs in the window do not appear
          here at all.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing merged in this window yet — try All time.</p>
      ) : (
        <table className="border-collapse text-sm w-full max-w-3xl">
          <thead>
            <tr className="text-left text-gray-700">
              <th className="border px-3 py-2">Engineer</th>
              <th className="border px-3 py-2" title="Median of created → last touched, per PR">
                Median review time
              </th>
              <th className="border px-3 py-2" title="Mean of created → last touched, per PR">
                Avg review time
              </th>
              <th className="border px-3 py-2" title="Merged-to-main PRs with a measured duration">Merged</th>
              <th className="border px-3 py-2" title="Still open — no landing time to measure yet">Open</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <FragmentRow
                key={row.personId}
                row={row}
                isOpen={open === row.personId}
                onToggle={() => setOpen(open === row.personId ? null : row.personId)}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function FragmentRow({
  row, isOpen, onToggle,
}: { row: LeaderboardRow; isOpen: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-gray-50" onClick={onToggle}>
        <td className="border px-3 py-2 font-medium text-gray-800">{isOpen ? "▾" : "▸"} {row.displayName}</td>
        <td className="border px-3 py-2 font-medium">{fmtDuration(row.medianReviewMs)}</td>
        <td className="border px-3 py-2 text-gray-600">{fmtDuration(row.averageReviewMs)}</td>
        <td className="border px-3 py-2">{row.prCount}</td>
        <td className="border px-3 py-2 text-gray-600">{row.openPrCount || ""}</td>
      </tr>
      {isOpen && (
        <tr>
          <td className="border px-3 py-2 bg-gray-50" colSpan={5}>
            <ul className="space-y-1">
              {row.prs.map((pr) => (
                <li key={`${pr.provider}:${pr.repoKey}#${pr.number}`} data-testid={`pr-${pr.number}`} className="flex justify-between gap-4">
                  <a className="text-blue-600 hover:underline truncate" href={pr.url} target="_blank" rel="noreferrer">
                    {pr.repoKey} #{pr.number} — {pr.title}
                  </a>
                  <span className="whitespace-nowrap text-gray-700">
                    {fmtDuration(pr.reviewMs)}{pr.readyForReviewPrecision === "fallback" ? " *" : ""}
                  </span>
                </li>
              ))}
            </ul>
            {row.prs.some((p) => p.readyForReviewPrecision === "fallback") && (
              <p className="mt-2 text-xs text-gray-500">* draft transition unknown — measured from PR creation.</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
