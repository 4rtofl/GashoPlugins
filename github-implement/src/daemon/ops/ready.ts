// A pull request ready for review (ready: true), or back to a draft (ready: false): { repo, number, ready }.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh } from "../core.ts";
import { numberArg, repoArg } from "../gh.ts";
import type { Op } from "../op.ts";

export const readyArgs = (repo: string, number: number, ready: boolean): string[] => ["pr", "ready", String(number), "--repo", repo, ...(ready ? [] : ["--undo"])];

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    if (typeof p.ready !== "boolean") throw new PluginError("Draft にするかの指定が正しくありません。");
    const ready = p.ready;
    await gh(`mark #${number} ${ready ? "ready" : "draft"}`, () => ctx.github.write(readyArgs(repo, number, ready), { repo }), ctx);
    return { ok: true };
  },
} satisfies Op;
