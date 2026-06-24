import type { User } from "@/types";

export type AppConfig = {
  users: User[];
  bitbucket: {
    workspace: string;
    repos: string[];
  };
};

export const config: AppConfig = {
  users: [
    {
      name: "Jeremy",
      bitbucketAccountId: "557058:36536540-4594-456e-982e-52982848159b", // TODO: populate via MCP — see CLAUDE.md setup guide
      jiraAccountId: "712020:255708e8-7794-4354-9797-13524837000b",       // TODO: populate via MCP — see CLAUDE.md setup guide
    },
  ],
  bitbucket: {
    workspace: "mvfglobal", // TODO: populate via MCP — e.g. "mvfglobal"
    repos: ["chameleon", "chameleon-gateway", "chameleon-results"],     // TODO: populate via MCP — list of repo slugs to track
  },
};
