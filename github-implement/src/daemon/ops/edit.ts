// Title, body, assignees and labels: { repo, kind, number, title?, body?, addAssignees?, removeAssignees?, addLabels?, removeLabels?, was? }.
// `was` ({ title?, bodyHash? }) is the title, or the hash of the body (edit-was.ts), the screen's edit started from:
// GitHub's is read again first, and the edit is refused when it is no longer that, as saving would undo what changed
// since (a session's gh pr edit, a task list's checkbox).
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { TEXT_HASH, textHash } from "../../edit-was.ts";
import type { GitHubKind } from "../../types.ts";
import { gh, readDetail, withTextFile, type Ctx } from "../core.ts";
import { cmd, kindArg, labelsArg, loginsArg, numberArg, repoArg, textArg } from "../gh.ts";
import type { Op } from "../op.ts";

// Values go after "=" (--title=…), so that a text starting with "-" is never taken as a flag. `bodyFile`: a file with
// the new body (withTextFile).
export function editArgs(repo: string, kind: GitHubKind, number: number, change: { title?: string; bodyFile?: string; addAssignees?: string[]; removeAssignees?: string[]; addLabels?: string[]; removeLabels?: string[] }): string[] {
  const args = [cmd(kind), "edit", String(number), "--repo", repo];
  if (change.title !== undefined) args.push(`--title=${change.title}`);
  if (change.bodyFile !== undefined) args.push(`--body-file=${change.bodyFile}`);
  for (const a of change.addAssignees ?? []) args.push(`--add-assignee=${a}`);
  for (const a of change.removeAssignees ?? []) args.push(`--remove-assignee=${a}`);
  for (const l of change.addLabels ?? []) args.push(`--add-label=${l}`);
  for (const l of change.removeLabels ?? []) args.push(`--remove-label=${l}`);
  return args;
}

/** The title and the hash of the body the edit started from; only those it edits. */
function wasArg(v: unknown): { title?: string; bodyHash?: string } | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "object" || v === null) throw new PluginError("編集を始めたときの値の指定が正しくありません。");
  const w = v as Record<string, unknown>;
  if (w.bodyHash !== undefined && (typeof w.bodyHash !== "string" || !TEXT_HASH.test(w.bodyHash))) throw new PluginError("編集を始めたときの本文の指定が正しくありません。");
  return { ...(w.title !== undefined ? { title: textArg(w.title, "編集を始めたときの題", 256) } : {}), ...(w.bodyHash !== undefined ? { bodyHash: w.bodyHash } : {}) };
}

async function checkUnchanged(ctx: Ctx, repo: string, kind: GitHubKind, number: number, was: { title?: string; bodyHash?: string }): Promise<void> {
  if (was.title === undefined && was.bodyHash === undefined) return;
  // The screen's own read, made fresh: when the edit is refused, gasho-daemon already holds the changed item for the
  // screen's read right after, which then shows the change. A read with other args would leave the old one kept.
  const now = await gh(`read ${kind} #${number}`, () => readDetail(ctx, repo, kind, number, { fresh: true }), ctx);
  if (was.title !== undefined && now.title !== was.title) throw new PluginError("編集を始めたあとに、GitHub で題が変わりました。保存していません。読み直した題を確かめてください。");
  if (was.bodyHash !== undefined && textHash(now.body) !== was.bodyHash) throw new PluginError("編集を始めたあとに、GitHub で本文が変わりました。保存していません。読み直した本文を確かめてください。");
}

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const kind = kindArg(p.kind);
    const number = numberArg(p.number);
    const was = wasArg(p.was);
    const title = p.title === undefined ? undefined : textArg(p.title, "題", 256);
    if (title !== undefined && !title.trim()) throw new PluginError("題を空にはできません。");
    const body = p.body === undefined ? undefined : textArg(p.body, "本文", 65_536);
    const change = {
      ...(title !== undefined ? { title } : {}),
      addAssignees: loginsArg(p.addAssignees),
      removeAssignees: loginsArg(p.removeAssignees),
      addLabels: labelsArg(p.addLabels),
      removeLabels: labelsArg(p.removeLabels),
    };
    if (was) await checkUnchanged(ctx, repo, kind, number, was);
    const edit = (bodyFile?: string) => ctx.github.write(editArgs(repo, kind, number, { ...change, ...(bodyFile !== undefined ? { bodyFile } : {}) }), { repo });
    await gh(`edit ${kind} #${number}`, () => (body === undefined ? edit() : withTextFile(body, edit)), ctx);
    return { ok: true };
  },
} satisfies Op;
