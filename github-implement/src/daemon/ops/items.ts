// A worktree's issues and pull requests: { repo, branch?, worktree, repoDir?, fresh? } → WorktreeItems. `repoDir` is the
// folder of the worktree's main worktree, where its HEAD is found (head.ts). It also writes down that Gasho showed the
// worktree, so that the background reads it again.
import { current, gh, KEEP_MAX_SECONDS, maxAge, readAllowingNotFound, readItems } from "../core.ts";
import { branchArg, isSameRepo, repoArg, sameRepoArgs, worktreeArg } from "../gh.ts";
import { worktreeHead } from "../head.ts";
import type { Op } from "../op.ts";

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const branch = branchArg(p.branch);
    const worktree = worktreeArg(p.worktree);
    const renamed = async (was: string): Promise<boolean> => {
      try {
        repoArg(was);
      } catch {
        return false;
      }
      return gh(`compare ${was} with ${repo}`, async () => isSameRepo(await readAllowingNotFound(ctx.github.read(sameRepoArgs(was, repo), { repo, maxAgeSeconds: KEEP_MAX_SECONDS }))), ctx);
    };
    const kept = await current().seen(worktree, repo, branch, Date.now(), renamed);
    const head = branch ? await worktreeHead(ctx, worktree, typeof p.repoDir === "string" ? p.repoDir : undefined) : undefined;
    return gh("read the items of a worktree", () => readItems(ctx, repo, branch, kept.added, maxAge(p), head), ctx);
  },
} satisfies Op;
