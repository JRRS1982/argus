import { describe, it, expect, vi } from "vitest";
import { fetchOrgRepos, fetchOrgMembers } from "@/lib/github/discover";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const page = (nodes: { login: string; name: string | null }[], next: string | null) =>
  json({ data: { organization: { membersWithRole: {
    nodes, pageInfo: { hasNextPage: next !== null, endCursor: next },
  } } } });

describe("fetchOrgRepos", () => {
  it("maps repos to the domain shape", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json([
      { name: "benchmarkme", default_branch: "main" },
      { name: "chameleon", default_branch: "master" },
    ]));
    expect(await fetchOrgRepos("mvfglobal", "tok", fetchFn)).toEqual([
      { repoKey: "benchmarkme", name: "benchmarkme", defaultBranch: "main", groupKey: null },
      { repoKey: "chameleon", name: "chameleon", defaultBranch: "master", groupKey: null },
    ]);
  });
});

describe("fetchOrgMembers", () => {
  it("reads logins and names from one GraphQL page", async () => {
    const fetchFn = vi.fn().mockResolvedValue(page([{ login: "JRRSMVF", name: "Jeremy Smith" }], null));
    expect(await fetchOrgMembers("mvfglobal", "tok", fetchFn))
      .toEqual([{ accountId: "JRRSMVF", displayName: "Jeremy Smith" }]);
  });

  it("falls back to the login when a member has no name, keeping nameless members distinct", async () => {
    const fetchFn = vi.fn().mockResolvedValue(page([
      { login: "mvfalcon", name: null }, { login: "ghost", name: "" }, { login: "blank", name: "   " },
    ], null));
    const members = await fetchOrgMembers("mvfglobal", "tok", fetchFn);
    expect(members).toEqual([
      { accountId: "mvfalcon", displayName: "mvfalcon" },
      { accountId: "ghost", displayName: "ghost" },
      { accountId: "blank", displayName: "blank" },
    ]);
    expect(new Set(members.map((m) => m.displayName)).size).toBe(members.length);
  });

  it("follows GraphQL cursors to the end, passing the cursor on", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(page([{ login: "a", name: "A" }], "CUR"))
      .mockResolvedValueOnce(page([{ login: "b", name: "B" }], null));
    const members = await fetchOrgMembers("mvfglobal", "tok", fetchFn);
    expect(members.map((m) => m.accountId)).toEqual(["a", "b"]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchFn.mock.calls[1][1].body).variables.cursor).toBe("CUR");
  });
});
