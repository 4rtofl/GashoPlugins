// Moves an issue to another repository of the same owner: { repo, number, to } → { url?, number? } of the issue in
// `to`, where it has a number of its own. Afterwards GitHub's GraphQL (and so `gh issue view`) no longer finds the old
// number, and the screen says where it went.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh } from "../core.ts";
import { numberArg, repoArg } from "../gh.ts";
import type { Op } from "../op.ts";

export const transferArgs = (repo: string, number: number, to: string): string[] => ["issue", "transfer", String(number), to, "--repo", repo];

/** Where the issue went; gh prints its new address. */
export interface Moved {
  url?: string;
  number?: number;
}

export function movedTo(stdout: string, to: string): Moved {
  const pattern = new RegExp(`^https://github\\.com/${to.replace(/[.]/g, "\\.")}/issues/(\\d{1,9})$`, "i");
  for (const line of stdout.split("\n")) {
    const m = pattern.exec(line.trim());
    if (m) return { url: line.trim(), number: Number(m[1]) };
  }
  return {};
}

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    const to = repoArg(p.to);
    if (to.toLowerCase() === repo.toLowerCase()) throw new PluginError("移す先が、いまのリポジトリと同じです。");
    if (to.split("/")[0]?.toLowerCase() !== repo.split("/")[0]?.toLowerCase()) throw new PluginError("Issue は、同じ owner のリポジトリにだけ移せます。");
    const { stdout } = await gh(`transfer #${number} to ${to}`, () => ctx.github.write(transferArgs(repo, number, to), { repo }), ctx);
    return movedTo(stdout, to);
  },
} satisfies Op;
