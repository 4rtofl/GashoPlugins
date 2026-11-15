// Asks for reviews, or takes the requests back: { repo, number, add?: string[], remove?: string[] }, each a login or a
// team as org/slug. A review already sent stays.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh } from "../core.ts";
import { numberArg, repoArg } from "../gh.ts";
import type { Op } from "../op.ts";

/** Logins, and teams as org/slug. */
export function reviewersArg(v: unknown): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 20 || !v.every((r) => typeof r === "string" && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,99})?$/.test(r))) {
    throw new PluginError("レビュアーの指定が正しくありません。");
  }
  return v as string[];
}

export const reviewersArgs = (repo: string, number: number, add: string[], remove: string[]): string[] => [
  "pr",
  "edit",
  String(number),
  "--repo",
  repo,
  ...add.map((r) => `--add-reviewer=${r}`),
  ...remove.map((r) => `--remove-reviewer=${r}`),
];

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    const add = reviewersArg(p.add);
    const remove = reviewersArg(p.remove);
    if (add.length + remove.length === 0) throw new PluginError("レビュアーの指定がありません。");
    await gh(`change the reviewers of #${number}`, () => ctx.github.write(reviewersArgs(repo, number, add, remove), { repo }), ctx);
    return { ok: true };
  },
} satisfies Op;
