// A repository's worktrees on the working server: { repoFolder } → { worktrees }. The screen of an issue or a pull
// request finds there the worktree of its branch, so that it opens that one rather than making another.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import type { Op } from "../op.ts";
import { allowed, folderArg, git, gitError, parseWorktrees, type GitWorktree } from "../worktree-git.ts";

export interface Worktrees {
  worktrees: GitWorktree[];
}

export default {
  kind: "read",
  async run(p, ctx) {
    const dir = allowed(ctx, folderArg(p.repoFolder, "リポジトリのフォルダー"), "リポジトリのフォルダー");
    try {
      const { stdout } = await git(ctx, dir)(["worktree", "list", "--porcelain"]);
      return { worktrees: parseWorktrees(stdout) } satisfies Worktrees;
    } catch (e) {
      ctx.log("could not list the worktrees", e);
      throw new PluginError(gitError(e));
    }
  },
} satisfies Op;
