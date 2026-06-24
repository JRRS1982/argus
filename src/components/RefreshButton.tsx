"use client";

type RefreshButtonProps = {
  onRefresh: () => void;
  loading: boolean;
  lastUpdated: string | null;
};

export default function RefreshButton({ onRefresh, loading, lastUpdated }: RefreshButtonProps) {
  return (
    <div className="flex items-center gap-4">
      <button
        onClick={onRefresh}
        disabled={loading}
        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
      >
        {loading ? "Refreshing..." : "Refresh Data"}
      </button>
      {lastUpdated && (
        <span className="text-sm text-gray-500">
          Last updated:{" "}
          <time dateTime={lastUpdated}>
            {new Date(lastUpdated).toLocaleString()}
          </time>
        </span>
      )}
    </div>
  );
}
