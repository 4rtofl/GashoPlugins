// Title, body, assignees and labels: { repo, kind, number, title?, body?, addAssignees?, removeAssignees?, addLabels?, removeLabels? }.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import type { GitHubKind } from "../../types.ts";
import { gh, withTextFile } from "../core.ts";
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

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const kind = kindArg(p.kind);
    const number = numberArg(p.number);
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
    const edit = (bodyFile?: string) => ctx.github.write(editArgs(repo, kind, number, { ...change, ...(bodyFile !== undefined ? { bodyFile } : {}) }), { repo });
    await gh(`edit ${kind} #${number}`, () => (body === undefined ? edit() : withTextFile(body, edit)), ctx);
    return { ok: true };
  },
} satisfies Op;
