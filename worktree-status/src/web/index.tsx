// The web part of Worktree Status: a grouping of the sidebar's worktrees, 「手で決めた状態」, under headings the person
// makes on the settings screen (settings.tsx) and drags the worktrees' rows into (headings.ts). Gasho draws the categories
// and the rows, and keeps the order the person dragged them into and the folding per browser. It needs Gasho's plugin
// API 1.9: the groupings of the sidebar's worktrees (P18) with useOnMove, and useSharedState.
import { useCallback, useMemo } from "react";
import { definePlugin, useSharedState, type WorktreeListContext, type WorktreeMove } from "@gasho/plugin-sdk";
import { DEFAULT_HEADINGS, HEADINGS, headingCategories, PLACED, place, type Heading, type Placed } from "./headings";
import { HeadingSettings } from "./settings";
import "./style.css";

function useHeadingCategories(ctx: WorktreeListContext) {
  const [headings] = useSharedState<Heading[]>(HEADINGS, DEFAULT_HEADINGS);
  const [placed] = useSharedState<Placed>(PLACED, {});
  return useMemo(() => headingCategories(headings, placed, ctx), [headings, placed, ctx]);
}

/** Gasho shows the row where it was dropped until the Gasho server has kept where it is. */
function useMoveToHeading(ctx: WorktreeListContext) {
  const [, setPlaced] = useSharedState<Placed>(PLACED, {});
  return useCallback(
    (move: WorktreeMove) => {
      const listed = new Set(ctx.worktrees.map((w) => w.key));
      return setPlaced((placed) => place(placed, move, listed));
    },
    [ctx, setPlaced],
  );
}

export default definePlugin({
  worktreeGroupings: [{ id: "manual", label: "手で決めた状態", useCategories: useHeadingCategories, useOnMove: useMoveToHeading }],
  settings: HeadingSettings,
});
