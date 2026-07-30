import Dashboard from "@/components/Dashboard";
import { isDemoAvailable, isDemoDefaultOn } from "@/config";

// Without this, Next.js has no dynamic API to key on and prerenders the page at
// build time, freezing these flags into the HTML shell. That desyncs from the API
// routes (which re-derive isDemoAvailable() per request): add credentials to an
// existing deployment without rebuilding, and the page would keep defaulting to
// demo mode while the API correctly serves real data underneath it.
export const dynamic = "force-dynamic";

// Server component: the demo flags are resolved before first paint, so a visitor
// never sees an empty dashboard flash before the data source is decided.
export default function Page() {
  return <Dashboard demoAvailable={isDemoAvailable()} demoDefaultOn={isDemoDefaultOn()} />;
}
