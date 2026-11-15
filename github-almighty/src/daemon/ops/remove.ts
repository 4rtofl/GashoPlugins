// Takes a number added by hand off a worktree: { worktree, number }.
import { current } from "../core.ts";
import { numberArg, worktreeArg } from "../gh.ts";
import type { Op } from "../op.ts";

export default {
  kind: "write",
  async run(p) {
    await current().remove(worktreeArg(p.worktree), numberArg(p.number));
    return { ok: true };
  },
} satisfies Op;
