// Title, body, assignees and labels: { repo, kind, number, title?, body?, addAssignees?, removeAssignees?, addLabels?, removeLabels?, was? }.
// `was` ({ title?, body? }) is the title or the body the screen's edit started from: GitHub's is read again first, and
// the edit is refused when it is no longer that, as saving would undo what changed since (a session's gh pr edit, a
// task list's checkbox).
import { PluginError } from "@gasho/plugin-sdk/daemon";
import type { GitHubKind } from "../../types.ts";
import { gh, type Ctx } from "../core.ts";
import { cmd, kindArg, labelsArg, loginsArg, numberArg, repoArg, str, textArg } from "../gh.ts";
import type { Op } from "../op.ts";

// Values go after "=" (--body=…), so that a text starting with "-" is never taken as a flag.
export function editArgs(repo: string, kind: GitHubKind, number: number, change: { title?: string; body?: string; addAssignees?: string[]; removeAssignees?: string[]; addLabels?: string[]; removeLabels?: string[] }): string[] {
  const args = [cmd(kind), "edit", String(number), "--repo", repo];
  if (change.title !== undefined) args.push(`--title=${change.title}`);
  if (change.body !== undefined) args.push(`--body=${change.body}`);
  for (const a of change.addAssignees ?? []) args.push(`--add-assignee=${a}`);
  for (const a of change.removeAssignees ?? []) args.push(`--remove-assignee=${a}`);
  for (const l of change.addLabels ?? []) args.push(`--add-label=${l}`);
  for (const l of change.removeLabels ?? []) args.push(`--remove-label=${l}`);
  return args;
}

/** The title and the body the edit started from; only those it edits. */
function wasArg(v: unknown): { title?: string; body?: string } | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "object" || v === null) throw new PluginError("編集を始めたときの値の指定が正しくありません。");
  const w = v as Record<string, unknown>;
  return { ...(w.title !== undefined ? { title: textArg(w.title, "編集を始めたときの題", 256) } : {}), ...(w.body !== undefined ? { body: textArg(w.body, "編集を始めたときの本文", 65_536) } : {}) };
}

async function checkUnchanged(ctx: Ctx, repo: string, kind: GitHubKind, number: number, was: { title?: string; body?: string }): Promise<void> {
  const fields = [...(was.title !== undefined ? ["title"] : []), ...(was.body !== undefined ? ["body"] : [])];
  if (fields.length === 0) return;
  // Read the same way as the screen's (gh … view --json), so that the same text compares equal.
  const { stdout } = await gh(`read ${kind} #${number}`, () => ctx.github.read([cmd(kind), "view", String(number), "--repo", repo, "--json", fields.join(",")], { repo, maxAgeSeconds: 0 }), ctx);
  const now = JSON.parse(stdout) as Record<string, unknown> | null;
  if (was.title !== undefined && str(now?.title) !== was.title) throw new PluginError("編集を始めたあとに、GitHub で題が変わりました。保存していません。読み直した題を確かめてください。");
  if (was.body !== undefined && (str(now?.body) ?? "") !== was.body) throw new PluginError("編集を始めたあとに、GitHub で本文が変わりました。保存していません。読み直した本文を確かめてください。");
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
    const change = {
      ...(title !== undefined ? { title } : {}),
      ...(p.body !== undefined ? { body: textArg(p.body, "本文", 65_536) } : {}),
      addAssignees: loginsArg(p.addAssignees),
      removeAssignees: loginsArg(p.removeAssignees),
      addLabels: labelsArg(p.addLabels),
      removeLabels: labelsArg(p.removeLabels),
    };
    if (was) await checkUnchanged(ctx, repo, kind, number, was);
    await gh(`edit ${kind} #${number}`, () => ctx.github.write(editArgs(repo, kind, number, change), { repo }), ctx);
    return { ok: true };
  },
} satisfies Op;
