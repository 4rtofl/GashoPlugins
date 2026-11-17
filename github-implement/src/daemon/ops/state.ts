// Close or reopen: { repo, kind, number, action: "close" | "reopen", reason?: "completed" | "not_planned" }.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import type { GitHubKind } from "../../types.ts";
import { gh } from "../core.ts";
import { cmd, kindArg, numberArg, repoArg } from "../gh.ts";
import type { Op } from "../op.ts";

/** An issue closes as done (completed) or as not planned; a pull request just closes. */
export function stateArgs(repo: string, kind: GitHubKind, number: number, action: "close" | "reopen", reason?: "completed" | "not_planned"): string[] {
  const args = [cmd(kind), action, String(number), "--repo", repo];
  if (action === "close" && kind === "issues" && reason) args.push(`--reason=${reason === "not_planned" ? "not planned" : "completed"}`);
  return args;
}

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const kind = kindArg(p.kind);
    const number = numberArg(p.number);
    if (p.action !== "close" && p.action !== "reopen") throw new PluginError("閉じるか開き直すかの指定が正しくありません。");
    if (p.reason !== undefined && p.reason !== "completed" && p.reason !== "not_planned") throw new PluginError("閉じる理由の指定が正しくありません。");
    const action = p.action;
    const reason = p.reason as "completed" | "not_planned" | undefined;
    await gh(`${action} ${kind} #${number}`, () => ctx.github.write(stateArgs(repo, kind, number, action, reason), { repo }), ctx);
    return { ok: true };
  },
} satisfies Op;
