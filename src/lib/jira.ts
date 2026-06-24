// Jira utilities — used during initial setup to resolve account IDs.
// The app itself does not query Jira at runtime; IDs are stored in src/config/index.ts.

const JIRA_BASE_URL = process.env.JIRA_BASE_URL; // e.g. "https://mvfglobal.atlassian.net"
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

const getJiraAuthHeader = (): string => {
  if (!JIRA_EMAIL || !JIRA_API_TOKEN) {
    throw new Error("Missing JIRA_EMAIL or JIRA_API_TOKEN env vars");
  }
  return `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64")}`;
};

export const resolveJiraAccountId = async (email: string): Promise<string> => {
  if (!JIRA_BASE_URL) throw new Error("Missing JIRA_BASE_URL env var");
  const url = `${JIRA_BASE_URL}/rest/api/3/user/search?query=${encodeURIComponent(email)}`;
  const res = await fetch(url, { headers: { Authorization: getJiraAuthHeader(), "Accept": "application/json" } });
  if (!res.ok) throw new Error(`Jira API error: ${res.status} ${res.statusText}`);
  const users = await res.json();
  if (!users.length) throw new Error(`No Jira user found for email: ${email}`);
  return users[0].accountId as string;
};
