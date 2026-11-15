// A new label of the repository: { repo, name, color, description? }. The screen puts it on the item with "edit" next.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh } from "../core.ts";
import { repoArg, textArg } from "../gh.ts";
import type { Op } from "../op.ts";

export interface NewLabel {
  name: string;
  /** 6 hex digits, without "#". */
  color: string;
  description?: string;
}

// Each value goes after "name=" and the like, so that a name starting with "-" is never taken as a flag. No --silent:
// GitHub says why it refused (already_exists) in the body, on stdout.
export const createLabelArgs = (repo: string, label: NewLabel): string[] => [
  "api",
  "--method",
  "POST",
  `repos/${repo}/labels`,
  "-f",
  `name=${label.name}`,
  "-f",
  `color=${label.color}`,
  ...(label.description ? ["-f", `description=${label.description}`] : []),
];

/** What GitHub takes as a label (a name of 50 characters at most), and what "edit" can put on: gh splits names at ",". */
export function newLabelArg(p: Record<string, unknown>): NewLabel {
  const name = textArg(p.name, "ラベルの名前", 50).trim();
  if (!name || /[\n\r,]/.test(name)) throw new PluginError("ラベルの名前を入れてください（「,」と改行は使えません）。");
  if (typeof p.color !== "string" || !/^[0-9a-f]{6}$/i.test(p.color)) throw new PluginError("ラベルの色は 16 進数 6 桁（例: 1d76db）で指定してください。");
  const description = p.description === undefined ? "" : textArg(p.description, "ラベルの説明", 100).trim();
  return { name, color: p.color.toLowerCase(), ...(description ? { description: description.replace(/[\n\r]+/g, " ") } : {}) };
}

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const label = newLabelArg(p);
    await gh(
      `create the label ${label.name}`,
      async () => {
        try {
          return await ctx.github.write(createLabelArgs(repo, label), { repo });
        } catch (e) {
          const text = [(e as { stderr?: unknown })?.stderr, (e as { stdout?: unknown })?.stdout].filter((t) => typeof t === "string").join("\n");
          if (text.includes("already_exists")) throw new PluginError(`ラベル「${label.name}」は、もうあります（大文字と小文字は区別されません）。`);
          throw e;
        }
      },
      ctx,
    );
    return { ok: true };
  },
} satisfies Op;
