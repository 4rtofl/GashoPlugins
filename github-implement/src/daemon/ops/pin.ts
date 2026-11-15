// Pins an issue to the top of its repository's issues (pin: true; GitHub allows 3), or unpins it (pin: false):
// { repo, number, pin }.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh } from "../core.ts";
import { numberArg, repoArg } from "../gh.ts";
import type { Op } from "../op.ts";

export const pinArgs = (repo: string, number: number, pin: boolean): string[] => ["issue", pin ? "pin" : "unpin", String(number), "--repo", repo];

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    if (typeof p.pin !== "boolean") throw new PluginError("ピン留めするかの指定が正しくありません。");
    const pin = p.pin;
    await gh(`${pin ? "pin" : "unpin"} #${number}`, () => ctx.github.write(pinArgs(repo, number, pin), { repo }), ctx);
    return { ok: true };
  },
} satisfies Op;
