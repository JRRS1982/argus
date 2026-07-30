import Dashboard from "@/components/Dashboard";
import { isDemoAvailable, isDemoDefaultOn } from "@/config";

// Server component: the demo flags are resolved before first paint, so a visitor
// never sees an empty dashboard flash before the data source is decided.
export default function Page() {
  return <Dashboard demoAvailable={isDemoAvailable()} demoDefaultOn={isDemoDefaultOn()} />;
}
