"use client";

import { useEffect, useState } from "react";
import Tabs, { type TabKey } from "@/components/Tabs";
import TeamTab from "@/components/TeamTab";
import LeaderboardTab from "@/components/LeaderboardTab";
import MatrixTable from "@/components/MatrixTable";
import Highlights from "@/components/Highlights";
import DemoToggle from "@/components/DemoToggle";
import { formatWindowLabel, type InsightsWindow } from "@/lib/window";
import type { InsightsResponse, UserRecord, RepoRecord } from "@/types";

type Roster = { users: UserRecord[]; repos: RepoRecord[] };
const EMPTY_MATRIX = { rowUsers: [], colHeaders: [], cells: [], rowTotals: [], colTotals: [] };

export default function Dashboard({
  demoAvailable, demoDefaultOn,
}: { demoAvailable: boolean; demoDefaultOn: boolean }) {
  const [tab, setTab] = useState<TabKey>("team");
  const [roster, setRoster] = useState<Roster>({ users: [], repos: [] });
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  // Named `range`, not `window`, to avoid shadowing the global in a client component.
  const [range, setRange] = useState<InsightsWindow>("6m");
  const [demo, setDemo] = useState(demoDefaultOn);

  useEffect(() => {
    fetch(`/api/roster${demo ? "?demo=1" : ""}`)
      .then((r) => r.json()).then(setRoster).catch(() => {});
  }, [demo]);

  // Recompute insights on load, on range change, when switching tabs (cheap; local DB),
  // and when demo mode toggles.
  useEffect(() => {
    fetch(`/api/insights?window=${range}${demo ? "&demo=1" : ""}`)
      .then((r) => r.json()).then(setInsights).catch(() => {});
  }, [tab, range, demo]);

  return (
    <main className="min-h-screen bg-white px-6 py-8">
      {/* Full width: the matrices are wide, so the viewport is the only useful constraint. */}
      <div className="w-full">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Argus</h1>
        <p className="text-sm text-gray-500 mb-2">What the team shipped — review flow, authorship, and who helps whom.</p>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2 mb-6">
          <RangeToggle range={range} onChange={setRange} />
          {demoAvailable && <DemoToggle on={demo} onChange={setDemo} />}
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

        <Highlights insights={insights} />

        <Tabs active={tab} onChange={setTab} />

        {tab === "team" && <TeamTab roster={roster} onRosterChange={setRoster} demo={demo} />}
        {tab === "leaderboard" && <LeaderboardTab rows={insights?.leaderboard ?? []} />}
        {tab === "created" && (
          <MatrixTable
            matrix={insights?.prsCreated ?? EMPTY_MATRIX}
            rowAxisLabel="Engineer"
            colAxisLabel="Repository"
            rowTotalLabel="PRs by engineer"
            colTotalLabel="PRs in repo"
            totalsPosition="leading"
            description="What each engineer shipped, and where. PRs by engineer is the headline — every PR opened inside the selected window, merged or still open (declined and superseded work is not counted against anyone). Services counts the distinct repositories someone shipped into: breadth of contribution rather than raw volume. The grid behind those two columns breaks the same PRs down per repository, so you can see where an engineer's work actually landed. Blank means no PRs there."
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
            description="Who helps whom get work over the line. Read a row as: of this author's PRs, how many each colleague reviewed and approved. Rows are PR authors and columns are approvers, both alphabetical; self-approvals are excluded, so the diagonal is greyed out. Each row's highest cell is highlighted — that author's most frequent reviewer, and every tied cell is highlighted rather than an arbitrary one. Totals count approvals, not PRs: 'Approvals received' is how many approvals an author's PRs collected in all, since one PR can be approved by several people; 'Approvals given' is how many that person handed out — a direct measure of how much they supported the rest of the team. The last column counts PRs merged with nobody else's approval: there is no reviewer to credit, but the work still happened. Declined PRs are ignored; the window above is applied to each PR's creation date, not the approval date."
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
