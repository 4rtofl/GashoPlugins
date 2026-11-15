// Merges a pull request's base into its head on GitHub, as GitHub's "Update branch" does: { repo, number }. A worktree
// of the head gets the merge with git pull.
import { gh } from "../core.ts";
import { numberArg, repoArg } from "../gh.ts";
import type { Op } from "../op.ts";

export const updateBranchArgs = (repo: string, number: number): string[] => ["pr", "update-branch", String(number), "--repo", repo];

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    await gh(`update the branch of #${number}`, () => ctx.github.write(updateBranchArgs(repo, number), { repo }), ctx);
    return { ok: true };
  },
} satisfies Op;
