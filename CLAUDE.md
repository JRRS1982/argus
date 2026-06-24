# PR Review Dashboard

A Next.js + TypeScript dashboard showing monthly PR review activity per engineer, pulling data from Bitbucket (MVF).

## Stack

- **Next.js 15** (App Router) + **TypeScript**
- **Tailwind CSS** for styling
- **Bitbucket REST API** for PR data
- Pure functions throughout

## Running the app

```bash
npm install
npm run dev   # http://localhost:3000
```

## Setup checklist

### 1. Create `.env.local`

Copy `.env.local.example` to `.env.local` and fill in your credentials:

```bash
cp .env.local.example .env.local
```

- **BITBUCKET_USERNAME**: your Bitbucket username
- **BITBUCKET_APP_PASSWORD**: create at https://bitbucket.org/account/settings/app-passwords/ with Repositories (Read) + Pull requests (Read) permissions

### 2. Configure MCP (for Claude dev access)

Edit `.claude/settings.json` and fill in your Atlassian email and API token.
Generate a token at: https://id.atlassian.com/manage-profile/security/api-tokens

### 3. Resolve and store IDs in config

Open `src/config/index.ts`. The following fields need populating (one-time setup using Claude + MCP):

- `users[].bitbucketAccountId` — your Bitbucket account UUID
- `users[].jiraAccountId` — your Jira account ID
- `bitbucket.workspace` — your Bitbucket workspace slug (e.g. `mvfglobal`)
- `bitbucket.repos` — array of repo slugs to track PRs across

**To find these values with Claude:**
1. Open this project in Claude Code (with Atlassian MCP configured)
2. Ask Claude: "What is my Jira account ID?" → paste result into `jiraAccountId`
3. Ask Claude: "List Bitbucket workspaces I have access to" → paste workspace slug
4. For `bitbucketAccountId`, check your Bitbucket profile URL or ask Claude via MCP
5. For repos, ask Claude to list repos in your workspace and add the relevant ones

Once IDs are stored in config, the app queries Bitbucket directly at runtime with no further discovery.

## Data flow

1. User clicks **Refresh Data** on the dashboard
2. Browser calls `POST /api/reviews` with `{ months: 3 }`
3. API route reads config IDs, calls Bitbucket REST API for each user × each month
4. Two queries per user per month: assigned-to-review count + approved count
5. Results merge into table state; last-updated timestamp updates

## Table usage

- Default view: last **9 months** of columns
- Click **+ month** to prepend an earlier month (no upper limit)
- Click **✕** on a column header to remove it (minimum 3 columns enforced)
- Click **Refresh Data** to fetch the latest 3 months (merges into existing data)

## Adding a new engineer

Add an entry to `config.users` in `src/config/index.ts`:

```typescript
{
  name: "Name",
  bitbucketAccountId: "their-bitbucket-uuid",
  jiraAccountId: "their-jira-account-id",
}
```
