// Adds an issue or pull request to a worktree by hand, once GitHub says it is there: { repo, worktree, number }.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { current, forgetMissing, gh, readItems } from "../core.ts";
import { numberArg, repoArg, worktreeArg } from "../gh.ts";
import type { Op } from "../op.ts";

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const worktree = worktreeArg(p.worktree);
    const number = numberArg(p.number);
    forgetMissing(repo, number);
    const items = await gh(`read #${number}`, () => readItems(ctx, repo, undefined, [number], 0), ctx);
    if (items.missing.includes(number)) throw new PluginError(`${repo} に #${number} はありません。`);
    await current().add(worktree, repo, number, Date.now());
    return { ok: true };
  },
} satisfies Op;
