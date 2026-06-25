"use client";

export type TabKey = "team" | "leaderboard" | "created" | "approvals";

const TABS: { key: TabKey; label: string }[] = [
  { key: "team", label: "Team" },
  { key: "leaderboard", label: "Review-time leaderboard" },
  { key: "created", label: "PRs created" },
  { key: "approvals", label: "Approvals" },
];

export default function Tabs({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  return (
    <nav className="flex gap-1 border-b mb-6">
      {TABS.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`px-4 py-2 text-sm -mb-px border-b-2 ${
            active === t.key ? "border-blue-600 text-blue-700 font-medium" : "border-transparent text-gray-500 hover:text-gray-700"
          }`}>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
