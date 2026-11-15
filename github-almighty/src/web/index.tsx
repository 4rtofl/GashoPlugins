// The web part of github-almighty: tabs beside a worktree's sessions for its issues and pull requests (P15), the
// screens they open, and, on the settings screen, how much of GitHub's hourly limit the background reads take.
import { definePlugin } from "@gasho/plugin-sdk";
import { HomeView } from "./home";
import { ItemView } from "./item/view";
import { RefreshSettings } from "./settings";
import { useItemTabs } from "./tabs.ts";
import "./style.css";

export default definePlugin({
  worktreeTabs: [{ id: "items", useTabs: useItemTabs }],
  worktreeViews: { home: HomeView, item: ItemView },
  settings: RefreshSettings,
});
