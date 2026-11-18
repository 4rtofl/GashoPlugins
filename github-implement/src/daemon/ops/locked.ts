// Whether the conversation of an issue or pull request is locked, and why: { repo, number, fresh? } → LockState.
// `gh … view --json` has no field for it, so this reads GitHub's REST API (a pull request is an issue there), which
// has an hourly limit of its own apart from the GraphQL points the background reads use.
import { gh, itemRead } from "../core.ts";
import { numberArg, repoArg } from "../gh.ts";
import type { Op } from "../op.ts";
import type { LockReason } from "./lock.ts";

export interface LockState {
  locked: boolean;
  reason?: LockReason;
}

export const lockedArgs = (repo: string, number: number): string[] => ["api", `repos/${repo}/issues/${number}`, "--jq", "{locked, reason: .active_lock_reason}"];

/** REST names the reasons as GitHub's lock API takes them ("off-topic", "too heated"); gh's --reason takes them with "_". */
const REST_REASON: Record<string, LockReason> = { "off-topic": "off_topic", "too heated": "too_heated", resolved: "resolved", spam: "spam" };

export function parseLocked(json: string): LockState {
  const r = (JSON.parse(json) ?? {}) as { locked?: unknown; reason?: unknown };
  const reason = typeof r.reason === "string" && Object.hasOwn(REST_REASON, r.reason) ? REST_REASON[r.reason] : undefined;
  return r.locked === true ? { locked: true, ...(reason && { reason }) } : { locked: false };
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    return gh(`read whether #${number} is locked`, async () => parseLocked((await itemRead(ctx, repo, number, p)(lockedArgs(repo, number))).stdout), ctx);
  },
} satisfies Op;
