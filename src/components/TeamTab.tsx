"use client";

import { useState } from "react";
import type { UserRecord, RepoRecord } from "@/types";

type Roster = { users: UserRecord[]; repos: RepoRecord[] };

export default function TeamTab({
  roster, onRosterChange, demo,
}: { roster: Roster; onRosterChange: (r: Roster) => void; demo: boolean }) {
  const [busy, setBusy] = useState<null | "discover" | "sync">(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadRoster = async () => {
    const res = await fetch(`/api/roster${demo ? "?demo=1" : ""}`);
    onRosterChange(await res.json());
  };

  const run = async (kind: "discover" | "sync") => {
    setBusy(kind); setError(null); setMessage(null);
    try {
      const res = await fetch(`/api/${kind}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Request failed"); return; }
      setMessage(kind === "discover"
        ? `Discovered ${json.users} users, ${json.repos} repos.`
        : `Synced ${json.totalPrs} PRs across ${json.repos.length} repos.`);
      await reloadRoster();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setBusy(null); }
  };

  const toggle = async (kind: "user" | "repo", id: string, included: boolean) => {
    const res = await fetch("/api/roster", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id, included }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setError(json?.error ?? "Request failed");
      return;
    }
    await reloadRoster();
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-3 items-center">
        <button onClick={() => run("discover")} disabled={busy !== null || demo}
          title={demo ? "Turn off demo data to talk to Bitbucket" : undefined}
          className="px-4 py-2 rounded bg-gray-800 text-white disabled:opacity-50">
          {busy === "discover" ? "Discovering…" : "Discover workspace"}
        </button>
        <button onClick={() => run("sync")} disabled={busy !== null || demo}
          title={demo ? "Turn off demo data to talk to Bitbucket" : undefined}
          className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50">
          {busy === "sync" ? "Refreshing…" : "Refresh data"}
        </button>
        {message && <span className="text-sm text-green-700">{message}</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>

      <p className="text-sm text-gray-600 max-w-4xl">
        <span className="font-medium">Discover workspace</span> lists every user and repository in the Bitbucket
        workspace; nothing is selected to begin with. Tick the engineers and repositories you want, then
        <span className="font-medium"> Refresh data</span> to pull their PR history. Only ticked repositories are
        fetched, and only ticked engineers appear in the other tabs.
      </p>

      {/* Two short lists of checkboxes; constrained so they don't stretch across a wide screen. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl">
        <RosterList title="Engineers" empty="No users yet — run Discover." demo={demo}
          items={roster.users.map((u) => ({ id: u.accountId, label: u.displayName, included: u.included }))}
          onToggle={(id, inc) => toggle("user", id, inc)} />
        <RosterList title="Repositories" empty="No repos yet — run Discover." demo={demo}
          items={roster.repos.map((r) => ({ id: r.slug, label: r.name, included: r.included }))}
          onToggle={(id, inc) => toggle("repo", id, inc)} />
      </div>
    </div>
  );
}

function RosterList({
  title, empty, items, onToggle, demo,
}: {
  title: string; empty: string;
  items: { id: string; label: string; included: boolean }[];
  onToggle: (id: string, included: boolean) => void;
  demo: boolean;
}) {
  return (
    <div>
      <h3 className="font-semibold text-gray-800 mb-2">{title}</h3>
      {items.length === 0 ? <p className="text-sm text-gray-500">{empty}</p> : (
        <ul className="space-y-1">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-2">
              <input type="checkbox" checked={it.included} disabled={demo}
                title={demo ? "Turn off demo data to change the roster" : undefined}
                onChange={(e) => onToggle(it.id, e.target.checked)} />
              <span className="text-sm text-gray-800">{it.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
