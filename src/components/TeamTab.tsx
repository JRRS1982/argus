"use client";

import { useState } from "react";
import type { UserRecord, RepoRecord, SkippedRepo } from "@/types";

type Roster = { users: UserRecord[]; repos: RepoRecord[] };

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export default function TeamTab({
  roster, onRosterChange, demo,
}: { roster: Roster; onRosterChange: (r: Roster) => void; demo: boolean }) {
  const [busy, setBusy] = useState<null | "discover" | "sync" | "backfill">(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<SkippedRepo[]>([]);
  // A run where nothing succeeded is one fault, not N deleted repos: a wrong
  // BITBUCKET_WORKSPACE 404s every URL alike. Offering to untick each one would
  // hand the user a way to wipe their own roster over a single misconfiguration.
  const [anyRepoSucceeded, setAnyRepoSucceeded] = useState(false);

  const reloadRoster = async () => {
    const res = await fetch(`/api/roster${demo ? "?demo=1" : ""}`);
    // A non-ok body still parses as JSON (an `{ error }` object) — only adopt it on
    // success, and keep the existing roster otherwise rather than clobbering it.
    if (res.ok) onRosterChange(await res.json());
  };

  const run = async (kind: "discover" | "sync" | "backfill") => {
    setBusy(kind); setError(null); setMessage(null); setSkipped([]); setAnyRepoSucceeded(false);
    try {
      const res = await fetch(
        kind === "discover" ? "/api/discover" : "/api/sync",
        kind === "backfill"
          ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ backfill: true }) }
          : { method: "POST" },
      );
      const json = await res.json();
      // A partial sync reports skipped repos alongside a 200; a total failure
      // reports them alongside its error. Show them either way.
      if (Array.isArray(json.skipped)) setSkipped(json.skipped);
      setAnyRepoSucceeded(Array.isArray(json.repos) && json.repos.length > 0);
      if (!res.ok) { setError(json.error ?? "Request failed"); return; }
      setMessage(kind === "discover"
        ? `Discovered ${json.users} users, ${json.repos} repos.`
        : `Synced ${plural(json.totalPrs, "PR")} across ${plural(json.repos.length, "repo")}.`
          // A rate-limited run is expected on a large backfill, not a fault: what finished
          // is saved, and running it again carries on from there.
          + (json.stoppedEarly
            ? ` Stopped early — ${json.stoppedEarly.reason} Everything that finished is saved; run it again to continue.`
            : json.skipped?.length ? ` ${json.skipped.length} skipped.` : ""));
      await reloadRoster();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setBusy(null); }
  };

  const toggle = async (kind: "user" | "repo", id: string, included: boolean): Promise<boolean> => {
    const res = await fetch("/api/roster", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id, included }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setError(json?.error ?? "Request failed");
      return false;
    }
    await reloadRoster();
    return true;
  };

  // Untick a repo that Bitbucket says is gone. Nothing unticks itself — a sync only
  // ever reports, so a temporary outage can never silently shrink the roster.
  const removeFromRoster = async (slug: string) => {
    if (await toggle("repo", slug, false)) {
      setSkipped((current) => current.filter((item) => item.repoKey !== slug));
    }
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
        <button onClick={() => run("backfill")} disabled={busy !== null || demo}
          title={demo
            ? "Turn off demo data to talk to Bitbucket"
            : "Re-fetch every PR each ticked repo has ever had, not just activity since the last refresh — needed once for All time to be complete"}
          className="px-4 py-2 rounded border border-gray-300 text-gray-700 disabled:opacity-50 hover:bg-gray-50">
          {busy === "backfill" ? "Backfilling…" : "Backfill all history"}
        </button>
        {message && <span className="text-sm text-green-700">{message}</span>}
      </div>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 max-w-4xl">
          {error}
        </p>
      )}

      {skipped.length > 0 && (
        <SkippedRepos items={skipped} repos={roster.repos} onRemove={removeFromRoster}
          allowRemoval={anyRepoSucceeded} />
      )}

      <p className="text-sm text-gray-600 max-w-4xl">
        <span className="font-medium">Discover workspace</span> lists every user and repository in the Bitbucket
        workspace; nothing is selected to begin with. Tick the engineers and repositories you want, then
        <span className="font-medium"> Refresh data</span> to pull their PR history. Only ticked repositories are
        fetched, and only ticked engineers appear in the other tabs. Refresh is incremental: it only asks
        Bitbucket for activity since the last refresh, and a repo&apos;s very first refresh reaches back just
        6 months. <span className="font-medium">Backfill all history</span> instead re-fetches every PR the
        ticked repositories have ever had — run it once if the All time view looks thin.
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

// Repos the last refresh could not read. Named, with the reason in words and — only
// where Bitbucket said the repo is gone — a one-click way to drop the stale roster
// entry. Everything else in the run still refreshed.
function SkippedRepos({
  items, repos, onRemove, allowRemoval,
}: {
  items: SkippedRepo[];
  repos: RepoRecord[];
  onRemove: (slug: string) => void;
  allowRemoval: boolean;
}) {
  const nameOf = (slug: string) => repos.find((r) => r.slug === slug)?.name ?? slug;
  return (
    <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 max-w-4xl">
      <h4 className="text-sm font-semibold text-amber-900">
        {items.length === 1 ? "1 repository was skipped" : `${items.length} repositories were skipped`}
      </h4>
      <p className="text-sm text-amber-800 mt-0.5">
        {allowRemoval
          ? "Every other selected repository refreshed normally. A skipped repository keeps its previous data and is retried on the next refresh."
          : "Nothing refreshed, so this is more likely one fault — credentials, or the workspace slug — than this many missing repositories. Fix that and refresh again; no repository is offered for removal until at least one succeeds."}
      </p>
      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li key={item.repoKey} className="text-sm text-amber-900 flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{nameOf(item.repoKey)}</span>
            <span className="text-amber-700">{item.reason}</span>
            {item.missing && allowRemoval && (
              <button onClick={() => onRemove(item.repoKey)}
                title="Untick this repository so future refreshes skip it"
                className="text-xs px-2 py-0.5 rounded border border-amber-400 text-amber-900 hover:bg-amber-100">
                Remove from roster
              </button>
            )}
          </li>
        ))}
      </ul>
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
