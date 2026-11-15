// The web part of github-almighty: tabs beside a worktree's sessions for its issues and pull requests (P15), the
// screens they open, the page "GitHub" of the sidebar with a repository's open issues and pull requests, and, on the
// settings screen, how much of GitHub's hourly limit the background reads take.
import { GitPullRequest } from "lucide-react";
import { definePlugin } from "@gasho/plugin-sdk";
import { HomeView } from "./home";
import { ItemView } from "./item/view";
import { GitHubPage } from "./page";
import { RefreshSettings } from "./settings";
import { useItemTabs } from "./tabs.ts";
import "./style.css";

export default definePlugin({
  worktreeTabs: [{ id: "items", useTabs: useItemTabs }],
  worktreeViews: { home: HomeView, item: ItemView },
  sidebar: [{ id: "github", label: "GitHub", icon: GitPullRequest, page: { id: "github" } }],
  pages: { github: GitHubPage },
  settings: RefreshSettings,
});
