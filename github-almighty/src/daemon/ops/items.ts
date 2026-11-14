// A worktree's issues and pull requests: { repo, branch?, worktree, fresh? } → WorktreeItems. It also writes down that
// Gasho showed the worktree, so that the background reads it again.
import { current, gh, maxAge, readItems } from "../core.ts";
import { branchArg, repoArg, worktreeArg } from "../gh.ts";
import type { Op } from "../op.ts";

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const branch = branchArg(p.branch);
    const kept = await current().seen(worktreeArg(p.worktree), repo, branch, Date.now());
    return gh("read the items of a worktree", () => readItems(ctx, repo, branch, kept.added, maxAge(p)), ctx);
  },
} satisfies Op;
