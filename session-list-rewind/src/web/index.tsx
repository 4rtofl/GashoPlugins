// The web part of Session List Rewind: the sidebar lists the sessions themselves again, in one category per
// repository, in place of Gasho's rows of worktrees; the tabs above a session leave out its worktree's sessions, which
// the sidebar now has (see categories.ts). Gasho draws the categories and keeps their folding and the order the person
// dragged them into. It needs Gasho's plugin API 1.7: the sidebar's session list (P17).
import { useMemo } from "react";
import { definePlugin, type SessionListContext } from "@gasho/plugin-sdk";
import { categories } from "./categories";

/** Called whenever the sidebar is drawn; Gasho makes a new context only when the sessions change. */
function useCategories(ctx: SessionListContext) {
  return useMemo(() => categories(ctx), [ctx]);
}

export default definePlugin({
  sessionList: { useCategories, hideSessionTabs: true },
});
