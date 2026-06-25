import { describe, it, expect, vi } from "vitest";
import { fetchWorkspaceMembers, fetchRepos } from "@/lib/bitbucket/discover";

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, statusText: "OK", json: async () => body }) as Response;

describe("fetchWorkspaceMembers", () => {
  it("maps members to accountId + displayName", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse({ values: [{ user: { account_id: "u1", display_name: "Alice" } }] }),
    );
    const members = await fetchWorkspaceMembers("ws", "auth", fetchFn as unknown as typeof fetch);
    expect(members).toEqual([{ accountId: "u1", displayName: "Alice" }]);
  });
});

describe("fetchRepos", () => {
  it("maps repos and reads the main branch name, defaulting to 'main'", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        values: [
          { slug: "repo-a", name: "Repo A", project: { key: "PROJ" }, mainbranch: { name: "master" } },
          { slug: "repo-b", name: "Repo B" },
        ],
      }),
    );
    const repos = await fetchRepos("ws", null, "auth", fetchFn as unknown as typeof fetch);
    expect(repos).toEqual([
      { slug: "repo-a", name: "Repo A", projectKey: "PROJ", mainBranch: "master" },
      { slug: "repo-b", name: "Repo B", projectKey: null, mainBranch: "main" },
    ]);
  });

  it("adds a project filter to the query when projectKey is given", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse({ values: [] }));
    await fetchRepos("ws", "PROJ", "auth", fetchFn as unknown as typeof fetch);
    const calledUrl = (fetchFn.mock.calls[0][0] as string);
    expect(decodeURIComponent(calledUrl)).toContain('project.key="PROJ"');
  });
});
