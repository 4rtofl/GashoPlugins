// A new issue: { repo, title, body, labels?, assignees?, worktree? } → { number?, url? }. With `worktree`, it is also
// added to the worktree, as one added by hand.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { current, forgetMissing, gh } from "../core.ts";
import { labelsArg, loginsArg, repoArg, textArg, worktreeArg } from "../gh.ts";
import type { Op } from "../op.ts";

export interface NewIssue {
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
}

// Values go after "=" (--title=…), so that a text starting with "-" is never taken as a flag. gh asks for --body when
// it does not run in a terminal, so an empty one is given too.
export function createIssueArgs(repo: string, c: NewIssue): string[] {
  const args = ["issue", "create", "--repo", repo, `--title=${c.title}`, `--body=${c.body}`];
  for (const l of c.labels) args.push(`--label=${l}`);
  for (const a of c.assignees) args.push(`--assignee=${a}`);
  return args;
}

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const worktree = p.worktree === undefined ? undefined : worktreeArg(p.worktree);
    const title = textArg(p.title, "題", 256);
    if (!title.trim()) throw new PluginError("題が空です。");
    const issue: NewIssue = { title, body: textArg(p.body ?? "", "本文", 65_536), labels: labelsArg(p.labels), assignees: loginsArg(p.assignees) };
    const { stdout } = await gh("create an issue", () => ctx.github.write(createIssueArgs(repo, issue), { repo }), ctx);
    // gh prints the new issue's URL.
    const m = /https:\/\/github\.com\/\S+\/issues\/(\d+)/.exec(stdout);
    if (!m) return {};
    const number = Number(m[1]);
    if (worktree) {
      forgetMissing(repo, number);
      await current().add(worktree, repo, number, Date.now());
    }
    return { number, url: m[0] };
  },
} satisfies Op;
