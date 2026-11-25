// The worktrees the screen may remove without asking once nobody uses them for "removeMergedMinutes": { shown? } →
// { now, worktrees: MergedWorktree[] }. Those shown in the last day (the ones read in the background) whose branch's pull
// request is merged at the commit the worktree has checked out, as the merged section of an item's screen takes them
// (gh.ts, isOwnPull); never the main worktree, nor a review worktree, which github-review removes. `shown`: the
// worktrees the asking page shows, which are in use now. `now` is the working server's clock, as the sessions' times are.
import { current, KEEP_MAX_SECONDS, readItems, SHOWN_WITHIN_MS } from "../core.ts";
import { listedWorktree, trimSlash, type WorktreeLists } from "../head.ts";
import type { Op } from "../op.ts";
import type { ItemSummary, MergedWorktree } from "../../types.ts";

/** github-review's review worktrees: review-<repository>-<number>, or review-<number> from before (its git.ts). */
const REVIEW_FOLDER = /^review-(?:.+-)?\d{1,9}$/;
const isReviewWorktree = (path: string): boolean => REVIEW_FOLDER.test(trimSlash(path).replace(/^.*\//, ""));

export default {
  kind: "read",
  async run(p, ctx) {
    const s = current();
    await s.load();
    const now = Date.now();
    for (const path of Array.isArray(p.shown) ? p.shown.slice(0, 20) : []) if (typeof path === "string") s.touch(path, now);
    const lists: WorktreeLists = new Map();
    const worktrees: MergedWorktree[] = [];
    for (const [path, w] of s.shownSince(now - SHOWN_WITHIN_MS)) {
      const { branch, repoDir } = w;
      if (!branch || !repoDir || trimSlash(path) === trimSlash(repoDir) || isReviewWorktree(path)) continue;
      // Gone, or another branch checked out since it was shown: the branch's pull request is not of what is there now.
      const listed = await listedWorktree(ctx, path, repoDir, lists);
      if (listed?.branch !== branch) continue;
      let pull: ItemSummary | undefined;
      try {
        // A merge shows within KEEP_MAX_SECONDS, sooner when the background reads read it.
        pull = (await readItems(ctx, w.repo, branch, w.added, KEEP_MAX_SECONDS, listed.head)).pulls.find((i) => i.state === "merged");
      } catch (e) {
        ctx.log(`could not read whether the pull request of ${path} is merged`, e);
        continue;
      }
      if (!pull) continue;
      worktrees.push({ path, repoDir, branch, repo: w.repo, number: pull.number, head: listed.head, seenAt: w.seenAt, ...(w.notRemoved ? { notRemoved: w.notRemoved } : {}) });
    }
    return { now, worktrees };
  },
} satisfies Op;
