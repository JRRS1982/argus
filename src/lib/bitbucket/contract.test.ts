import { describeProviderContract } from "@/lib/providers/contract";
import { createBitbucketProvider } from "./adapter";

// Recorded-shape Bitbucket payloads, served offline so the real adapter (and the real
// parsing beneath it) runs against the same contract as the fixture.
const pr = (id: number, state: string) => ({
  id, title: "t", state, created_on: "2026-01-01T00:00:00Z", updated_on: "2026-01-03T00:00:00Z",
  author: { account_id: "a1" }, destination: { branch: { name: "main" } },
  links: { html: { href: `https://x/${id}` } },
  participants: [{ approved: true, user: { account_id: "r1" } }],
});
const activity = { values: [
  { update: { date: "2026-01-02T00:00:00Z", draft: false } },
  { approval: { date: "2026-01-02T12:00:00Z", user: { account_id: "r1" } } },
] };

const fakeFetch = ((url: string) => {
  let body: unknown;
  if (url.includes("/members")) {
    body = { values: [{ user: { account_id: "a1", display_name: "Alice" } }] };
  } else if (url.includes("/activity")) {
    body = activity;
  } else if (url.includes("/pullrequests")) {
    body = { values: [pr(1, "MERGED"), pr(2, "OPEN"), pr(3, "DECLINED")] };
  } else {
    body = { values: [{ slug: "r", name: "R", project: { key: "P" }, mainbranch: { name: "main" } }] };
  }
  return Promise.resolve({ ok: true, status: 200, statusText: "OK", json: () => Promise.resolve(body) });
}) as unknown as typeof fetch;

describeProviderContract("bitbucket", () =>
  createBitbucketProvider({ workspace: "w", projectKey: null, auth: "x", fetchFn: fakeFetch }));
