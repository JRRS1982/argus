import { isDemoAvailable } from "@/config";

// Demo data must never be servable from an instance that has real data behind it,
// or fabricated numbers could be mistaken for real ones.
export const isDemoRequest = (url: URL, env: NodeJS.ProcessEnv = process.env): boolean =>
  url.searchParams.get("demo") === "1" && isDemoAvailable(env);
