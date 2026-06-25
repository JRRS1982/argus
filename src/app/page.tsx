"use client";

import { useEffect, useState } from "react";
import Tabs, { type TabKey } from "@/components/Tabs";
import TeamTab from "@/components/TeamTab";
import LeaderboardTab from "@/components/LeaderboardTab";
import MatrixTable from "@/components/MatrixTable";
import type { InsightsResponse, UserRecord, RepoRecord } from "@/types";

type Roster = { users: UserRecord[]; repos: RepoRecord[] };
const EMPTY_MATRIX = { rowUsers: [], colHeaders: [], cells: [], rowTotals: [], colTotals: [] };

export default function Home() {
  const [tab, setTab] = useState<TabKey>("team");
  const [roster, setRoster] = useState<Roster>({ users: [], repos: [] });
  const [insights, setInsights] = useState<InsightsResponse | null>(null);

  useEffect(() => {
    fetch("/api/roster").then((r) => r.json()).then(setRoster).catch(() => {});
    fetch("/api/insights").then((r) => r.json()).then(setInsights).catch(() => {});
  }, []);

  // Recompute insights whenever the user switches to an analytics tab (cheap; reads local DB).
  useEffect(() => {
    if (tab !== "team") fetch("/api/insights").then((r) => r.json()).then(setInsights).catch(() => {});
  }, [tab]);

  return (
    <main className="min-h-screen bg-white p-8">
      <div className="max-w-screen-xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Argus</h1>
        <p className="text-sm text-gray-500 mb-6">Team PR insights — review times, authorship, and who approves whom (last 6 months).</p>

        <Tabs active={tab} onChange={setTab} />

        {tab === "team" && <TeamTab roster={roster} onRosterChange={setRoster} />}
        {tab === "leaderboard" && <LeaderboardTab rows={insights?.leaderboard ?? []} />}
        {tab === "created" && <MatrixTable matrix={insights?.prsCreated ?? EMPTY_MATRIX} cornerLabel="Engineer \ Project" />}
        {tab === "approvals" && <MatrixTable matrix={insights?.approvals ?? EMPTY_MATRIX} cornerLabel="Author \ Approver" />}
      </div>
    </main>
  );
}
