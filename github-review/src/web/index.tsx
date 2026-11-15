// The web part of github-review: "レビュー" in the sidebar (P1), its page (P2) with the pull requests to review and
// their review worktrees, and the editor of the templates below the setting (P5).
import { GitPullRequestArrow } from "lucide-react";
import { definePlugin } from "@gasho/plugin-sdk";
import { ReviewPage } from "./page";
import { TemplateSettings } from "./settings";
import "./style.css";

export default definePlugin({
  sidebar: [{ id: "review", label: "レビュー", icon: GitPullRequestArrow, page: { id: "review" } }],
  pages: { review: ReviewPage },
  settings: TemplateSettings,
});
