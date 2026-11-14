// The web part of the GitHub plugin: "Issues" and "Pull requests" in a session's header (between its branch and its
// files, as before the plugin), their panels (the list, and one issue or pull request with its conversation), and the
// GitHub tile of the home screen.
import { CircleDot, GitPullRequest } from "lucide-react";
import { definePlugin, githubRepos, type SessionContext } from "@gasho/plugin-sdk";
import { ItemPanel, ListPanel } from "./panels";
import { RepoCounts } from "./tile";
import "./style.css";

/** The session's folder, or a repository inside it, is on GitHub, and gh can be run on its working server. */
const onGitHub = (c: SessionContext) => c.daemon.ready && githubRepos(c.session).length > 0;

export default definePlugin({
  sessionHeader: [
    {
      id: "issues",
      label: "Issues",
      icon: CircleDot,
      title: "このリポジトリの Issue を開く",
      order: 300,
      when: onGitHub,
      panel: { id: "list", params: { kind: "issues" } },
      isOpen: (p) => p.params.kind === "issues",
    },
    {
      id: "pulls",
      label: "Pull requests",
      icon: GitPullRequest,
      title: "このリポジトリの Pull request を開く",
      order: 300,
      when: onGitHub,
      panel: { id: "list", params: { kind: "pulls" } },
      isOpen: (p) => p.params.kind === "pulls",
    },
  ],
  sessionPanels: { list: ListPanel, item: ItemPanel },
  homeTiles: [{ id: "repos", title: "GitHub", size: "small", after: "operations", component: RepoCounts }],
});
