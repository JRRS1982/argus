"use client";

// App Router error boundary: catches any render throw below this segment (e.g. a
// future bug that reintroduces the "malformed insights payload" crash this branch
// fixed) and shows a readable message with a retry instead of Next's blank default
// error page.
export default function Error({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-white px-6">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-lg font-semibold text-gray-900">Something went wrong</h1>
        <p className="text-sm text-gray-600">
          {error.message || "An unexpected error occurred while rendering this page."}
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 rounded bg-gray-800 text-white text-sm"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
