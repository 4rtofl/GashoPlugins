// Merge a pull request, or turn its auto-merge on or off:
// { repo, number, action: "merge", method: "merge" | "squash" | "rebase", deleteBranch?: boolean, head?: <sha> }
// { repo, number, action: "auto", method, head? } and { repo, number, action: "cancel-auto" }.
// `head` is the head commit the screen showed: GitHub refuses the merge if the branch has moved since.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh } from "../core.ts";
import { numberArg, repoArg } from "../gh.ts";
import type { Op } from "../op.ts";
import type { MergeMethod } from "./mergeable.ts";

export type MergeAction = { action: "merge"; method: MergeMethod; deleteBranch?: boolean; head?: string } | { action: "auto"; method: MergeMethod; head?: string } | { action: "cancel-auto" };

// With --repo, gh deletes only the branch on GitHub, never the local one (which a worktree may have checked out). An
// auto-merge deletes nothing: GitHub merges later, and deletes the branch then only if the repository says so.
export function mergeArgs(repo: string, number: number, a: MergeAction): string[] {
  const args = ["pr", "merge", String(number), "--repo", repo];
  if (a.action === "cancel-auto") return [...args, "--disable-auto"];
  if (a.action === "auto") args.push("--auto");
  args.push(`--${a.method}`);
  if (a.action === "merge" && a.deleteBranch) args.push("--delete-branch");
  if (a.head) args.push(`--match-head-commit=${a.head}`);
  return args;
}

function methodArg(v: unknown): MergeMethod {
  if (v !== "merge" && v !== "squash" && v !== "rebase") throw new PluginError("マージの方法の指定が正しくありません。");
  return v;
}

function headArg(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !/^[0-9a-f]{40}$/.test(v)) throw new PluginError("head のコミットの指定が正しくありません。");
  return v;
}

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    const head = headArg(p.head);
    let a: MergeAction;
    if (p.action === "merge") {
      if (p.deleteBranch !== undefined && typeof p.deleteBranch !== "boolean") throw new PluginError("ブランチを消すかの指定が正しくありません。");
      a = { action: "merge", method: methodArg(p.method), deleteBranch: p.deleteBranch === true, ...(head ? { head } : {}) };
    } else if (p.action === "auto") {
      a = { action: "auto", method: methodArg(p.method), ...(head ? { head } : {}) };
    } else if (p.action === "cancel-auto") {
      a = { action: "cancel-auto" };
    } else {
      throw new PluginError("マージの操作の指定が正しくありません。");
    }
    await gh(
      `${a.action} #${number}`,
      () =>
        ctx.github.write(mergeArgs(repo, number, a), { repo }).catch((e: unknown) => {
          const text = [(e as { stderr?: unknown })?.stderr, (e as { message?: unknown })?.message].filter((t) => typeof t === "string").join("\n");
          if (/Head branch was modified/i.test(text)) throw new PluginError("画面で読んだあとに、head のブランチに push がありました。読み直して、中身を確かめてからマージしてください。");
          throw e;
        }),
      ctx,
    );
    return { ok: true };
  },
} satisfies Op;
