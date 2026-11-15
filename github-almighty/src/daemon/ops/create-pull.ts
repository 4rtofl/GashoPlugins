// A new pull request of a branch: { repo, branch, base, title, body, draft } → { number?, url? }. The branch must be on
// GitHub already: gh gets --head, so it never pushes or forks.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh } from "../core.ts";
import { branchArg, repoArg, textArg } from "../gh.ts";
import type { Op } from "../op.ts";

export interface NewPullRequest {
  branch: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
}

// Values go after "=" (--title=…), so that a text starting with "-" is never taken as a flag.
export const createPullArgs = (repo: string, c: NewPullRequest): string[] => [
  "pr",
  "create",
  "--repo",
  repo,
  `--head=${c.branch}`,
  `--base=${c.base}`,
  `--title=${c.title}`,
  `--body=${c.body}`,
  ...(c.draft ? ["--draft"] : []),
];

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const branch = branchArg(p.branch);
    const base = branchArg(p.base);
    if (!branch || !base) throw new PluginError("ブランチと base を指定してください。");
    if (branch === base) throw new PluginError("ブランチと同じ base には Pull request を作れません。");
    const title = textArg(p.title, "題", 256);
    if (!title.trim()) throw new PluginError("題が空です。");
    const body = textArg(p.body ?? "", "本文", 65_536);
    if (typeof p.draft !== "boolean") throw new PluginError("Draft にするかの指定が正しくありません。");
    const { stdout } = await gh(`create a pull request of ${branch}`, () => ctx.github.write(createPullArgs(repo, { branch, base, title, body, draft: p.draft as boolean }), { repo }), ctx);
    // gh prints the new pull request's URL.
    const m = /https:\/\/github\.com\/\S+\/pull\/(\d+)/.exec(stdout);
    return m ? { number: Number(m[1]), url: m[0] } : {};
  },
} satisfies Op;
