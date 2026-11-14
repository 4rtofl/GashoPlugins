// Whether the conversation of an issue or pull request is locked, and why: { repo, number, fresh? } → LockState.
// `gh … view --json` has no field for it, so this reads GitHub's REST API (a pull request is an issue there), which
// has an hourly limit of its own apart from the GraphQL points the background reads use.
import { gh, maxAge } from "../core.ts";
import { numberArg, repoArg } from "../gh.ts";
import type { Op } from "../op.ts";
import { isLockReason, type LockReason } from "./lock.ts";

export interface LockState {
  locked: boolean;
  reason?: LockReason;
}

export const lockedArgs = (repo: string, number: number): string[] => ["api", `repos/${repo}/issues/${number}`, "--jq", "{locked, reason: .active_lock_reason}"];

export function parseLocked(json: string): LockState {
  const r = (JSON.parse(json) ?? {}) as { locked?: unknown; reason?: unknown };
  return r.locked === true ? { locked: true, ...(isLockReason(r.reason) && { reason: r.reason }) } : { locked: false };
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    return gh(`read whether #${number} is locked`, async () => parseLocked((await ctx.github.read(lockedArgs(repo, number), { maxAgeSeconds: maxAge(p) })).stdout), ctx);
  },
} satisfies Op;
