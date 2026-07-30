"use client";

export default function DemoToggle({
  on, onChange,
}: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        aria-label="Show demo data"
      />
      <span>
        Demo data
        {on && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">fabricated</span>}
      </span>
    </label>
  );
}
