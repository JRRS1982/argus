"use client";

import { useState } from "react";
import ReviewTable from "@/components/ReviewTable";
import RefreshButton from "@/components/RefreshButton";
import { getLastNMonthColumns, subtractMonths, buildMonthColumn } from "@/lib/dates";
import { config } from "@/config";
import type { MonthColumn, ReviewData } from "@/types";

const DEFAULT_DISPLAY_MONTHS = 9;
const REFRESH_MONTHS = 3;

export default function Home() {
  const [columns, setColumns] = useState<MonthColumn[]>(() =>
    getLastNMonthColumns(DEFAULT_DISPLAY_MONTHS)
  );
  const [data, setData] = useState<ReviewData>({});
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const userNames = config.users.map((u) => u.name);

  const handleRefresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ months: REFRESH_MONTHS }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to fetch data");
        return;
      }
      // Merge new data into existing data (new data takes precedence for fetched months)
      setData((prev) => {
        const next = { ...prev };
        for (const [user, monthData] of Object.entries(json.data as ReviewData)) {
          next[user] = { ...(prev[user] ?? {}), ...monthData };
        }
        return next;
      });
      setLastUpdated(json.fetchedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleAddColumn = () => {
    setColumns((prev) => {
      const oldest = prev[0];
      const { year, month } = subtractMonths(oldest.year, oldest.month, 1);
      return [buildMonthColumn(year, month), ...prev];
    });
  };

  const handleRemoveColumn = (key: string) => {
    setColumns((prev) => {
      if (prev.length <= 3) return prev;
      return prev.filter((c) => c.key !== key);
    });
  };

  return (
    <main className="min-h-screen bg-white p-8">
      <div className="max-w-screen-xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">PR Review Dashboard</h1>
        <p className="text-sm text-gray-500 mb-6">
          Monthly PR review activity — approved and assigned to review counts per engineer.
        </p>

        <div className="mb-6">
          <RefreshButton
            onRefresh={handleRefresh}
            loading={loading}
            lastUpdated={lastUpdated}
          />
          {error && (
            <p className="mt-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <ReviewTable
          columns={columns}
          data={data}
          users={userNames}
          onAddColumn={handleAddColumn}
          onRemoveColumn={handleRemoveColumn}
        />
      </div>
    </main>
  );
}
