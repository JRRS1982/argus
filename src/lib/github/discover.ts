import { GITHUB_API, fetchAllPages, graphql, type FetchFn } from "./client";

type RawRepo = { name: string; default_branch: string };

// GitHub has no project/group layer equivalent to a Bitbucket project key, so groupKey
// is always null. The PRs-created matrix groups by service regardless.
export const fetchOrgRepos = async (
  org: string,
  token: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<{ repoKey: string; name: string; defaultBranch: string; groupKey: null }[]> => {
  const url = `${GITHUB_API}/orgs/${org}/repos?per_page=100&sort=full_name`;
  const raw = await fetchAllPages<RawRepo>(url, token, fetchFn);
  return raw.map((r) => ({
    repoKey: r.name,
    name: r.name,
    defaultBranch: r.default_branch,
    groupKey: null,
  }));
};

const MEMBERS_QUERY = `
  query($org: String!, $cursor: String) {
    organization(login: $org) {
      membersWithRole(first: 100, after: $cursor) {
        nodes { login name }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

type MembersPage = {
  organization: {
    membersWithRole: {
      nodes: { login: string; name: string | null }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
};

// REST's /orgs/{org}/members returns the minimal user object with no `name`, which
// would mean one extra REST call per member. One GraphQL query batches ~100 per page.
export const fetchOrgMembers = async (
  org: string,
  token: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<{ accountId: string; displayName: string }[]> => {
  const out: { accountId: string; displayName: string }[] = [];
  let cursor: string | null = null;
  for (;;) {
    const data: MembersPage = await graphql<MembersPage>(
      MEMBERS_QUERY, { org, cursor }, token, fetchFn,
    );
    const { nodes, pageInfo } = data.organization.membersWithRole;
    // An unset (or blank) name falls back to the login, never to a shared empty string:
    // linking on a blank name would merge every nameless account into one person.
    out.push(...nodes.map((n) => ({
      accountId: n.login,
      displayName: n.name && n.name.trim() !== "" ? n.name : n.login,
    })));
    if (!pageInfo.hasNextPage) return out;
    cursor = pageInfo.endCursor;
  }
};
