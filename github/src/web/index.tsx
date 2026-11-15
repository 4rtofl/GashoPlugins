// The web part of the GitHub plugin: "Actions", "Projects" and "Packages" in a session's header, right of the Git
// plugin's "Issues" and "Pull requests", and their panels (a list, and one run, project or package of it).
import { Box, KanbanSquare, PlayCircle } from "lucide-react";
import { definePlugin, githubRepos, type OpenPanel, type SessionContext } from "@gasho/plugin-sdk";
import { RunPanel, RunsPanel } from "./actions";
import { PackagePanel, PackagesPanel } from "./packages";
import { BoardPanel, ProjectsPanel } from "./projects";
import "./style.css";

/** The session's folder, or a repository inside it, is on GitHub, and gh can be run on its working server. */
const onGitHub = (c: SessionContext) => c.daemon.ready && githubRepos(c.session).length > 0;

/** The item shows as pressed for its list and for what opens from it. */
const opens = (...ids: string[]) => (p: OpenPanel) => p.plugin === "github" && ids.includes(p.id);

export default definePlugin({
  sessionHeader: [
    {
      id: "actions",
      label: "Actions",
      icon: PlayCircle,
      title: "このリポジトリの GitHub Actions の実行を開く",
      order: 310,
      when: onGitHub,
      panel: { id: "actions" },
      isOpen: opens("actions", "run"),
    },
    {
      id: "projects",
      label: "Projects",
      icon: KanbanSquare,
      title: "このリポジトリの Project を開く",
      order: 320,
      when: onGitHub,
      panel: { id: "projects" },
      isOpen: opens("projects", "project"),
    },
    {
      id: "packages",
      label: "Packages",
      icon: Box,
      title: "このリポジトリのパッケージを開く",
      order: 330,
      when: onGitHub,
      panel: { id: "packages" },
      isOpen: opens("packages", "package"),
    },
  ],
  sessionPanels: { actions: RunsPanel, run: RunPanel, projects: ProjectsPanel, project: BoardPanel, packages: PackagesPanel, package: PackagePanel },
});
