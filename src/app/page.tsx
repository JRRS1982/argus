"use client";

import { useEffect, useState } from "react";
import Tabs, { type TabKey } from "@/components/Tabs";
import TeamTab from "@/components/TeamTab";
import LeaderboardTab from "@/components/LeaderboardTab";
import MatrixTable from "@/components/MatrixTable";
import { formatWindowLabel, type InsightsWindow } from "@/lib/window";
import type { InsightsResponse, UserRecord, RepoRecord } from "@/types";

type Roster = { users: UserRecord[]; repos: RepoRecord[] };
const EMPTY_MATRIX = { rowUsers: [], colHeaders: [], cells: [], rowTotals: [], colTotals: [] };

export default function Home() {
  const [tab, setTab] = useState<TabKey>("team");
  const [roster, setRoster] = useState<Roster>({ users: [], repos: [] });
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  // Named `range`, not `window`, to avoid shadowing the global in a client component.
  const [range, setRange] = useState<InsightsWindow>("6m");

  useEffect(() => {
    fetch("/api/roster").then((r) => r.json()).then(setRoster).catch(() => {});
  }, []);

  // Recompute insights on load, on range change, and when switching tabs (cheap; local DB).
  useEffect(() => {
    fetch(`/api/insights?window=${range}`).then((r) => r.json()).then(setInsights).catch(() => {});
  }, [tab, range]);

  return (
    <main className="min-h-screen bg-white px-6 py-8">
      {/* Full width: the matrices are wide, so the viewport is the only useful constraint. */}
      <div className="w-full">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Argus</h1>
        <p className="text-sm text-gray-500 mb-2">Team PR insights — review times, authorship, and who approves whom.</p>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2 mb-6">
          <RangeToggle range={range} onChange={setRange} />
          <p className="text-sm text-gray-600 max-w-4xl">
            {range === "6m" ? (
              <>
                <span className="font-medium">Rolling 6 months</span>
                {insights ? `: ${formatWindowLabel(insights.sinceIso, insights.generatedAt)}` : ""} — moves with
                today&apos;s date, so it is recalculated on every view and older PRs drop out of the figures below.
              </>
            ) : (
              <>
                <span className="font-medium">All time</span>
                {insights ? `: ${formatWindowLabel(insights.sinceIso, insights.generatedAt)}` : ""} — every PR held in
                the local cache. Older periods are patchier, since each repo was only backfilled 6 months on its first sync.
              </>
            )}
          </p>
        </div>

        <Tabs active={tab} onChange={setTab} />

        {tab === "team" && <TeamTab roster={roster} onRosterChange={setRoster} />}
        {tab === "leaderboard" && <LeaderboardTab rows={insights?.leaderboard ?? []} />}
        {tab === "created" && (
          <MatrixTable
            matrix={insights?.prsCreated ?? EMPTY_MATRIX}
            rowAxisLabel="Engineer"
            colAxisLabel="Repository"
            rowTotalLabel="PRs by engineer"
            colTotalLabel="PRs in repo"
            description="How many PRs each engineer opened in each repository, counting PRs created inside the selected window above. Merged and still-open PRs count; declined and superseded ones do not. Rows are engineers (alphabetical), columns are the included repositories. 'PRs by engineer' totals a row — that engineer's output across every repo; 'PRs in repo' totals a column — everyone's output in that repo. Services counts the distinct repositories an engineer opened at least one PR in — a measure of breadth rather than volume. Blank means no PRs."
          />
        )}
        {tab === "approvals" && (
          <MatrixTable
            matrix={insights?.approvals ?? EMPTY_MATRIX}
            rowAxisLabel="PR author"
            colAxisLabel="Approver"
            rowTotalLabel="Approvals received"
            colTotalLabel="Approvals given"
            highlightRowMax
            description="Who reviews whose work. Read a row as: of this author's PRs, how many each colleague approved. Rows are PR authors and columns are approvers (both alphabetical); self-approvals are excluded, so the diagonal is greyed out. Each row's highest cell is highlighted — that author's most frequent approver (all tied cells are highlighted). Totals count approvals, not PRs: 'Approvals received' totals a row — how many approvals that author's PRs collected in all (one PR can be approved by several people); 'Approvals given' totals a column — how many approvals that person handed out. The last column counts PRs that were merged with no approval from anyone else: they have no approver to attribute, but they still happened. Declined PRs are ignored; the window above is applied to each PR's creation date, not the approval date."
          />
        )}
      </div>
    </main>
  );
}

function RangeToggle({
  range, onChange,
}: { range: InsightsWindow; onChange: (r: InsightsWindow) => void }) {
  const options: { key: InsightsWindow; label: string }[] = [
    { key: "6m", label: "Last 6 months" },
    { key: "all", label: "All time" },
  ];
  return (
    <div className="inline-flex rounded border border-gray-300 overflow-hidden" role="group" aria-label="Date range">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          aria-pressed={range === o.key}
          className={
            range === o.key
              ? "px-3 py-1 text-sm bg-gray-800 text-white"
              : "px-3 py-1 text-sm bg-white text-gray-700 hover:bg-gray-50"
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
