// What the background reads: the worktrees shown in the last day, and the interval → { worktrees, refreshSeconds }.
import { current, refreshSeconds, SHOWN_WITHIN_MS } from "../core.ts";
import type { Op } from "../op.ts";

export default {
  kind: "read",
  async run() {
    const s = current();
    await s.load();
    return { worktrees: s.shownSince(Date.now() - SHOWN_WITHIN_MS).length, refreshSeconds: refreshSeconds() };
  },
} satisfies Op;
