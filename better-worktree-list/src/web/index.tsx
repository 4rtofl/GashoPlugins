// The web part of Better WorktreeList: two groupings of the sidebar's worktrees, picked in the menu of the list:
// one category per repository (repo.ts), or one per state, 確認待ち・作業中・待機中・オフライン・セッションなし
// (status.ts). Gasho draws the categories and the worktrees' rows, and keeps the grouping picked, the folding and the
// order the person dragged things into. It needs Gasho's plugin API 1.8: the groupings of the sidebar's worktrees (P18).
import { useMemo } from "react";
import { definePlugin, type WorktreeListContext } from "@gasho/plugin-sdk";
import { repoCategories } from "./repo";
import { statusCategories } from "./status";

/** Called whenever the sidebar is drawn; Gasho makes a new context only when the worktrees change. */
function useRepoCategories(ctx: WorktreeListContext) {
  return useMemo(() => repoCategories(ctx), [ctx]);
}

function useStatusCategories(ctx: WorktreeListContext) {
  return useMemo(() => statusCategories(ctx), [ctx]);
}

export default definePlugin({
  worktreeGroupings: [
    { id: "repo", label: "リポジトリごと", useCategories: useRepoCategories },
    { id: "status", label: "作業中・待機中", useCategories: useStatusCategories },
  ],
});
