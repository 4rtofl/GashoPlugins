// What a page does with a worktree of the operation "merged" it removes without asking: { action, worktree, problem? }.
// "claim" → { claimed }: it may go on, and no other page tries the same worktree for CLAIM_MS (pages open in several
// browsers each look). "failed" with `problem`: it was not removed, which the merged section shows; it is not tried
// again until the worktree is used after now. "removed": it is gone, and nothing of it is kept.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { current } from "../core.ts";
import { textArg, worktreeArg } from "../gh.ts";
import type { Op } from "../op.ts";

/** A page that claimed and went away leaves the worktree to the others after this. Removing may take 90 seconds. */
const CLAIM_MS = 2 * 60_000;

const claims = new Map<string, number>();

export default {
  kind: "write",
  async run(p) {
    const worktree = worktreeArg(p.worktree);
    const now = Date.now();
    if (p.action === "claim") {
      if ((claims.get(worktree) ?? 0) > now) return { claimed: false };
      claims.set(worktree, now + CLAIM_MS);
      return { claimed: true };
    }
    if (p.action === "failed") await current().notRemoved(worktree, textArg(p.problem, "削除しなかった理由", 1000), now);
    else if (p.action === "removed") await current().forget(worktree);
    else throw new PluginError("自動で削除する worktree への操作の指定が正しくありません。");
    claims.delete(worktree);
    return { ok: true };
  },
} satisfies Op;
