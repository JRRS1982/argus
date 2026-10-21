import { describeProviderContract } from "@/lib/providers/contract";
import { createBitbucketProvider } from "./adapter";

// Recorded-shape Bitbucket payloads, served offline so the real adapter (and the real
// parsing beneath it) runs against the same contract as the fixture.
const pr = (id: number, state: string, created: string, updated: string) => ({
  id, title: "t", state, created_on: created, updated_on: updated,
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
    // Bitbucket filters on updated_on server-side (q=updated_on>="..."), so the fake must too,
    // or the cursor would be untestable. Distinct dates let a later cursor exclude some.
    const since = /updated_on>="([^"]+)"/.exec(decodeURIComponent(url));
    const cursor = since ? Date.parse(since[1]) : 0;
    body = { values: [
      pr(1, "MERGED", "2026-01-01T00:00:00Z", "2026-01-03T00:00:00Z"),
      pr(2, "OPEN", "2026-01-05T00:00:00Z", "2026-01-06T00:00:00Z"),
      pr(3, "DECLINED", "2026-01-10T00:00:00Z", "2026-01-11T00:00:00Z"),
    ].filter((v) => Date.parse(v.updated_on) >= cursor) };
  } else {
    body = { values: [{ slug: "r", name: "R", project: { key: "P" }, mainbranch: { name: "main" } }] };
  }
  return Promise.resolve({ ok: true, status: 200, statusText: "OK", json: () => Promise.resolve(body) });
}) as unknown as typeof fetch;

describeProviderContract("bitbucket", () =>
  createBitbucketProvider({ workspace: "w", projectKey: null, auth: "x", fetchFn: fakeFetch }));
