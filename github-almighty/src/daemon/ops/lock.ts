// Locks the conversation of an issue or pull request (lock: true), so that only those with write access can comment,
// with a reason or none; or unlocks it (lock: false): { repo, kind, number, lock, reason? }.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import type { GitHubKind } from "../../types.ts";
import { gh } from "../core.ts";
import { cmd, kindArg, numberArg, repoArg } from "../gh.ts";
import type { Op } from "../op.ts";

export const LOCK_REASONS = ["off_topic", "too_heated", "resolved", "spam"] as const;
export type LockReason = (typeof LOCK_REASONS)[number];

export const isLockReason = (v: unknown): v is LockReason => LOCK_REASONS.includes(v as LockReason);

export const lockArgs = (repo: string, kind: GitHubKind, number: number, lock: boolean, reason?: LockReason): string[] => [
  cmd(kind),
  lock ? "lock" : "unlock",
  String(number),
  "--repo",
  repo,
  ...(lock && reason ? [`--reason=${reason}`] : []),
];

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const kind = kindArg(p.kind);
    const number = numberArg(p.number);
    if (typeof p.lock !== "boolean") throw new PluginError("ロックするかの指定が正しくありません。");
    if (p.reason !== undefined && !isLockReason(p.reason)) throw new PluginError("ロックの理由の指定が正しくありません。");
    const lock = p.lock;
    const reason = p.reason as LockReason | undefined;
    await gh(`${lock ? "lock" : "unlock"} #${number}`, () => ctx.github.write(lockArgs(repo, kind, number, lock, reason), { repo }), ctx);
    return { ok: true };
  },
} satisfies Op;
