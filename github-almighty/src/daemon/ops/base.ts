// The branch a pull request merges into: { repo, number, base }.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh } from "../core.ts";
import { branchArg, numberArg, repoArg } from "../gh.ts";
import type { Op } from "../op.ts";

export const baseArgs = (repo: string, number: number, base: string): string[] => ["pr", "edit", String(number), "--repo", repo, `--base=${base}`];

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    const base = branchArg(p.base);
    if (!base) throw new PluginError("base のブランチを選んでください。");
    await gh(`change the base of #${number}`, () => ctx.github.write(baseArgs(repo, number, base), { repo }), ctx);
    return { ok: true };
  },
} satisfies Op;
