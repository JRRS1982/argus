"use client";

import { computeHighlights } from "@/lib/analytics/highlights";
import type { InsightsResponse } from "@/types";

export default function Highlights({ insights }: { insights: InsightsResponse | null }) {
  if (!insights) return null;
  const items = computeHighlights(insights);
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3 mb-6">
      {items.map((h) => (
        <div key={h.key} className="rounded border border-gray-200 bg-gray-50 px-4 py-2">
          <div className="text-xs uppercase tracking-wide text-gray-500">{h.label}</div>
          <div className="text-sm font-semibold text-gray-800">{h.engineer}</div>
          <div className="text-xs text-gray-600">{h.value}</div>
        </div>
      ))}
    </div>
  );
}
