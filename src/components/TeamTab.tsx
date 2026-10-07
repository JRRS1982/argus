"use client";

import { useState } from "react";
import IdentityBadges from "@/components/IdentityBadges";
import { byIncludedThenName } from "@/lib/roster-order";
import type { Person, Service, SkippedRepo, ProviderId, IdentityState } from "@/types";

export type Roster = {
  people: Person[];
  services: Service[];
  // Providers with an active identity on a ticked service but no credentials here.
  unconfiguredProviders?: ProviderId[];
};

type Kind = "person" | "service";
type Entry = {
  id: number; name: string; included: boolean;
  identities: { provider: ProviderId; key: string; state?: IdentityState }[];
};

const CREDENTIALS: Record<ProviderId, string> = {
  bitbucket: "BITBUCKET_EMAIL and BITBUCKET_API_TOKEN",
  github: "GITHUB_TOKEN",
};
const PROVIDER_LABEL: Record<ProviderId, string> = { bitbucket: "Bitbucket", github: "GitHub" };

const personEntries = (people: Person[]): Entry[] => people.map((p) => ({
  id: p.id, name: p.displayName, included: p.included,
  identities: p.identities.map((i) => ({ provider: i.provider, key: i.accountId })),
}));
const serviceEntries = (services: Service[]): Entry[] => services.map((s) => ({
  id: s.id, name: s.name, included: s.included,
  identities: s.identities.map((i) => ({ provider: i.provider, key: i.repoKey, state: i.state })),
}));

// A person created from PR authorship under their login (display name === login) is the
// undiscovered-member case: the token sees only some org members, so the rest arrive
// later under their login and do not auto-link to their Bitbucket person.
const isLoginOnly = (e: Entry) =>
  e.identities.length === 1 && e.identities[0].key.toLowerCase() === e.name.toLowerCase();

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export default function TeamTab({
  roster, onRosterChange, demo = false,
  skipped: initialSkipped = [], anyRepoSucceeded: initialSucceeded = false,
}: {
  roster: Roster; onRosterChange?: (r: Roster) => void; demo?: boolean;
  // Seed the last run's warnings (the tab otherwise learns them from its own runs).
  skipped?: SkippedRepo[]; anyRepoSucceeded?: boolean;
}) {
  const [busy, setBusy] = useState<null | "discover" | "sync" | "backfill">(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<SkippedRepo[]>(initialSkipped);
  // A run where nothing succeeded is one fault, not N deleted repos: a wrong
  // BITBUCKET_WORKSPACE 404s every URL alike. Offering to untick each one would
  // hand the user a way to wipe their own roster over a single misconfiguration.
  const [anyRepoSucceeded, setAnyRepoSucceeded] = useState(initialSucceeded);

  const reloadRoster = async () => {
    const res = await fetch(`/api/roster${demo ? "?demo=1" : ""}`);
    // A non-ok body still parses as JSON (an `{ error }` object) — only adopt it on
    // success, and keep the existing roster otherwise rather than clobbering it.
    if (res.ok) onRosterChange?.(await res.json());
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

  // Every roster write goes through here, keyed by canonical id. Returns whether it stuck.
  const patch = async (body: Record<string, unknown>): Promise<boolean> => {
    const res = await fetch("/api/roster", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setError(json?.error ?? "Request failed");
      return false;
    }
    await reloadRoster();
    return true;
  };
  const toggle = (kind: Kind, id: number, included: boolean) => patch({ kind, id, included });
  const merge = (kind: Kind, provider: ProviderId, key: string, intoId: number) =>
    patch({ kind, action: "merge", provider, key, intoId });
  const split = (kind: Kind, provider: ProviderId, key: string) =>
    patch({ kind, action: "split", provider, key });

  // Untick a service whose every identity is gone. Nothing unticks itself — a sync only
  // ever reports, so a temporary outage can never silently shrink the roster.
  const removeFromRoster = async (serviceId: number) => {
    if (await toggle("service", serviceId, false)) {
      const service = roster.services.find((x) => x.id === serviceId);
      setSkipped((current) => current.filter((item) =>
        !service?.identities.some((i) => i.provider === item.provider && i.repoKey === item.repoKey)));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-3 items-center">
        <button onClick={() => run("discover")} disabled={busy !== null || demo}
          title={demo ? "Turn off demo data to use real providers" : undefined}
          className="px-4 py-2 rounded bg-gray-800 text-white disabled:opacity-50">
          {busy === "discover" ? "Discovering…" : "Discover workspace"}
        </button>
        <button onClick={() => run("sync")} disabled={busy !== null || demo}
          title={demo ? "Turn off demo data to use real providers" : undefined}
          className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50">
          {busy === "sync" ? "Refreshing…" : "Refresh data"}
        </button>
        <button onClick={() => run("backfill")} disabled={busy !== null || demo}
          title={demo
            ? "Turn off demo data to use real providers"
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
        <SkippedRepos items={skipped} services={roster.services} onRemove={removeFromRoster}
          allowRemoval={anyRepoSucceeded} />
      )}

      {(roster.unconfiguredProviders ?? []).map((provider) => (
        <p key={provider} className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 max-w-4xl">
          Ticked repositories have an active {PROVIDER_LABEL[provider]} identity, but no {PROVIDER_LABEL[provider]} credentials
          are configured ({CREDENTIALS[provider]}), so a refresh skips them without fetching anything.
        </p>
      ))}

      <p className="text-sm text-gray-600 max-w-4xl">
        <span className="font-medium">Discover workspace</span> lists every member and repository in the GitHub
        organisation; nothing is selected to begin with. Tick the engineers and repositories you want, then
        <span className="font-medium"> Refresh data</span> to pull their PR history. Only ticked repositories are
        fetched, and only ticked engineers appear in the other tabs. Refresh is incremental: it only asks
        GitHub for activity since the last refresh, and a repo&apos;s very first refresh reaches back just
        6 months. Bitbucket is a frozen archive: its history still counts in every tab but is never fetched. <span className="font-medium">Backfill all history</span> instead re-fetches every PR the
        ticked repositories have ever had — run it once if the All time view looks thin.
      </p>

      {/* Two short lists of checkboxes; constrained so they don't stretch across a wide screen. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl">
        <RosterList title="Engineers" kind="person" empty="No users yet — run Discover." demo={demo}
          entries={personEntries(roster.people)}
          onToggle={toggle} onMerge={merge} onSplit={split} />
        <RosterList title="Repositories" kind="service" empty="No repos yet — run Discover." demo={demo}
          entries={serviceEntries(roster.services)}
          onToggle={toggle} onMerge={merge} onSplit={split} />
      </div>
    </div>
  );
}

// Repos the last refresh could not read. Named, with the reason in words and — only
// where Bitbucket said the repo is gone — a one-click way to drop the stale roster
// entry. Everything else in the run still refreshed.
function SkippedRepos({
  items, services, onRemove, allowRemoval,
}: {
  items: SkippedRepo[];
  services: Service[];
  onRemove: (serviceId: number) => void;
  allowRemoval: boolean;
}) {
  const serviceOf = (item: SkippedRepo) =>
    services.find((s) => s.identities.some((i) => i.provider === item.provider && i.repoKey === item.repoKey));
  // A service holding archived Bitbucket history is never offered: that history is
  // irreplaceable and cannot be re-fetched. Only when every identity is gone (or is the
  // one this run just found gone) is dropping the entry safe.
  const removableId = (item: SkippedRepo): number | null => {
    const service = serviceOf(item);
    if (!service || !item.missing || !allowRemoval) return null;
    const gone = service.identities.every((i) =>
      i.state === "missing" || (i.provider === item.provider && i.repoKey === item.repoKey));
    return gone ? service.id : null;
  };
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
        {items.map((item) => {
          const removable = removableId(item);
          return (
            <li key={`${item.provider}-${item.repoKey}`} className="text-sm text-amber-900 flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{serviceOf(item)?.name ?? item.repoKey}</span>
              <span className="text-amber-700">{item.reason}</span>
              {removable !== null && (
                <button onClick={() => onRemove(removable)}
                  title="Untick this repository so future refreshes skip it"
                  className="text-xs px-2 py-0.5 rounded border border-amber-400 text-amber-900 hover:bg-amber-100">
                  Remove from roster
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RosterList({
  title, kind, empty, entries, onToggle, onMerge, onSplit, demo,
}: {
  title: string; kind: Kind; empty: string; entries: Entry[];
  onToggle: (kind: Kind, id: number, included: boolean) => void;
  onMerge: (kind: Kind, provider: ProviderId, key: string, intoId: number) => void;
  onSplit: (kind: Kind, provider: ProviderId, key: string) => void;
  demo: boolean;
}) {
  const [merging, setMerging] = useState<number | null>(null);
  const sorted = [...entries].sort(byIncludedThenName);
  const lookalikes = kind === "person" ? sorted.filter(isLoginOnly) : [];
  const readOnly = demo ? "Turn off demo data to change the roster" : undefined;

  return (
    <div>
      <h3 className="font-semibold text-gray-800 mb-2">{title}</h3>
      {lookalikes.length > 0 && (
        <p className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
          Possible duplicates: {plural(lookalikes.length, "person")} appear only under a login
          ({lookalikes.slice(0, 3).map((e) => e.name).join(", ")}{lookalikes.length > 3 ? ", …" : ""}).
          They are likely someone already listed under their Bitbucket name — use <span className="font-medium">same as…</span> to
          merge them.
        </p>
      )}
      {sorted.length === 0 ? <p className="text-sm text-gray-500">{empty}</p> : (
        <ul className="space-y-1">
          {sorted.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2">
              <input type="checkbox" checked={e.included} disabled={demo} aria-label={e.name}
                title={readOnly} onChange={(ev) => onToggle(kind, e.id, ev.target.checked)} />
              <span className="text-sm text-gray-800">{e.name}</span>
              <IdentityBadges identities={e.identities.map((i) => ({ provider: i.provider, state: i.state }))} />
              {kind === "person" && isLoginOnly(e) && (
                <span className="text-xs text-amber-700">possible duplicate</span>
              )}
              {e.identities.length === 1 && merging !== e.id && (
                <button disabled={demo} title={readOnly} onClick={() => setMerging(e.id)}
                  className="text-xs text-blue-700 hover:underline disabled:opacity-50">
                  same as…
                </button>
              )}
              {merging === e.id && (
                <select autoFocus aria-label={`Merge ${e.name} into`} defaultValue=""
                  onBlur={() => setMerging(null)}
                  onChange={(ev) => {
                    const intoId = Number(ev.target.value);
                    setMerging(null);
                    if (intoId) onMerge(kind, e.identities[0].provider, e.identities[0].key, intoId);
                  }}
                  className="text-xs border border-gray-300 rounded max-w-48">
                  <option value="">Same as…</option>
                  {sorted.filter((o) => o.id !== e.id).map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              )}
              {e.identities.length > 1 && e.identities.map((i) => (
                <button key={`${i.provider}-${i.key}`} disabled={demo} title={readOnly ?? `Give ${PROVIDER_LABEL[i.provider]} ${i.key} its own entry again`}
                  onClick={() => onSplit(kind, i.provider, i.key)}
                  className="text-xs text-gray-600 hover:underline disabled:opacity-50">
                  split {PROVIDER_LABEL[i.provider]}
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
