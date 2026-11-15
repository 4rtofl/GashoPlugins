// Sets the milestone of an issue or pull request by its number, or takes it off (null): { repo, number, milestone }.
// GitHub's REST API takes a pull request as an issue here, so one call does both kinds.
import { gh } from "../core.ts";
import { numberArg, repoArg } from "../gh.ts";
import type { Op } from "../op.ts";

// -F turns "null" into JSON null, which takes the milestone off.
export const milestoneArgs = (repo: string, number: number, milestone: number | null): string[] => [
  "api",
  "--method",
  "PATCH",
  `repos/${repo}/issues/${number}`,
  "-F",
  `milestone=${milestone ?? "null"}`,
  "--silent",
];

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    const milestone = p.milestone === null ? null : numberArg(p.milestone);
    await gh(`set the milestone of #${number}`, () => ctx.github.write(milestoneArgs(repo, number, milestone), { repo }), ctx);
    return { ok: true };
  },
} satisfies Op;
