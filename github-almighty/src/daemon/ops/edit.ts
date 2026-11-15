// Title, body, assignees and labels: { repo, kind, number, title?, body?, addAssignees?, removeAssignees?, addLabels?, removeLabels? }.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import type { GitHubKind } from "../../types.ts";
import { gh } from "../core.ts";
import { cmd, kindArg, labelsArg, loginsArg, numberArg, repoArg, textArg } from "../gh.ts";
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

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const kind = kindArg(p.kind);
    const number = numberArg(p.number);
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
    await gh(`edit ${kind} #${number}`, () => ctx.github.write(editArgs(repo, kind, number, change), { repo }), ctx);
    return { ok: true };
  },
} satisfies Op;
