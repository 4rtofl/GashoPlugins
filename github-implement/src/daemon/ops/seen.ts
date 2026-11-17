// What an item's screen shows, every time it reads the item: { repo, number, marks: SeenMarks }. The item's worktree tab
// then counts only what comes after (ops/news.ts). It changes only what github-implement keeps, as "items" writes down
// that a worktree showed, and opening a tab is not an operation for Gasho's log: a read.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import type { SeenMarks } from "../../news.ts";
import { numberArg, objArg, repoArg } from "../gh.ts";
import type { Op } from "../op.ts";
import { seenKey, seenStore } from "../seen.ts";

function marksArg(v: unknown): SeenMarks {
  const m = objArg(v);
  const marks: SeenMarks = {};
  for (const k of ["comment", "review", "check"] as const) {
    const t = m[k];
    if (t === undefined) continue;
    if (typeof t !== "string" || t.length > 40 || Number.isNaN(Date.parse(t))) throw new PluginError("見た印の指定が正しくありません。");
    marks[k] = t;
  }
  return marks;
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    await seenStore(ctx.dataDir).mark(seenKey(repo, number), marksArg(p.marks), Date.now());
    return { ok: true };
  },
} satisfies Op;
