// A new comment: { repo, kind, number, body }.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import type { GitHubKind } from "../../types.ts";
import { gh } from "../core.ts";
import { cmd, kindArg, numberArg, repoArg, textArg } from "../gh.ts";
import type { Op } from "../op.ts";

export const commentArgs = (repo: string, kind: GitHubKind, number: number, body: string): string[] => [cmd(kind), "comment", String(number), "--repo", repo, `--body=${body}`];

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const kind = kindArg(p.kind);
    const number = numberArg(p.number);
    const body = textArg(p.body, "コメント", 65_536);
    if (!body.trim()) throw new PluginError("コメントが空です。");
    await gh(`comment on ${kind} #${number}`, () => ctx.github.write(commentArgs(repo, kind, number, body), { repo }), ctx);
    return { ok: true };
  },
} satisfies Op;
