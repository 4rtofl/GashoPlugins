// The screen's reload button: { repo } → { ok: true }. What the screen reads next of the repository's worktree items
// and of their parts (their conversation, checks, files, …) is read with gh from now, not what gasho-daemon kept from
// before (core.ts, askFresh). It changes only what the daemon part keeps in memory: a read.
import { askFresh } from "../core.ts";
import { repoArg } from "../gh.ts";
import type { Op } from "../op.ts";

export default {
  kind: "read",
  async run(p) {
    askFresh(repoArg(p.repo));
    return { ok: true };
  },
} satisfies Op;
