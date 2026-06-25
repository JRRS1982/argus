import { BITBUCKET_API, fetchAllPages, type FetchFn } from "./client";

type MemberValue = { user: { account_id: string; display_name: string } };
type RepoValue = {
  slug: string;
  name: string;
  project?: { key: string };
  mainbranch?: { name: string };
};

export const fetchWorkspaceMembers = async (
  workspace: string,
  auth: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<{ accountId: string; displayName: string }[]> => {
  const url = `${BITBUCKET_API}/workspaces/${workspace}/members?pagelen=100`;
  const values = await fetchAllPages<MemberValue>(url, auth, fetchFn);
  return values.map((v) => ({ accountId: v.user.account_id, displayName: v.user.display_name }));
};

export const fetchRepos = async (
  workspace: string,
  projectKey: string | null,
  auth: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<{ slug: string; name: string; projectKey: string | null; mainBranch: string }[]> => {
  const fields = "fields=values.slug,values.name,values.project.key,values.mainbranch.name,next";
  const query = projectKey ? `&q=${encodeURIComponent(`project.key="${projectKey}"`)}` : "";
  const url = `${BITBUCKET_API}/repositories/${workspace}?pagelen=100&${fields}${query}`;
  const values = await fetchAllPages<RepoValue>(url, auth, fetchFn);
  return values.map((v) => ({
    slug: v.slug,
    name: v.name,
    projectKey: v.project?.key ?? null,
    mainBranch: v.mainbranch?.name ?? "main",
  }));
};
