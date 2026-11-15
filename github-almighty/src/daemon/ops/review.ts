// A review of a pull request: { repo, number, event: "approve" | "request_changes" | "comment", body? }. A comment and a
// request for changes need a body. GitHub refuses the author's own approval and request for changes.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh } from "../core.ts";
import { numberArg, repoArg, textArg } from "../gh.ts";
import type { Op } from "../op.ts";

const EVENTS = { approve: "--approve", request_changes: "--request-changes", comment: "--comment" } as const;

export type ReviewEvent = keyof typeof EVENTS;

export const reviewArgs = (repo: string, number: number, event: ReviewEvent, body: string): string[] => ["pr", "review", String(number), "--repo", repo, EVENTS[event], ...(body ? [`--body=${body}`] : [])];

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    if (typeof p.event !== "string" || !Object.hasOwn(EVENTS, p.event)) throw new PluginError("レビューの種類の指定が正しくありません。");
    const event = p.event as ReviewEvent;
    const body = p.body === undefined ? "" : textArg(p.body, "レビューの本文", 65_536);
    if (event !== "approve" && !body.trim()) throw new PluginError("コメントと修正の依頼には、本文が要ります。");
    await gh(`review #${number}`, () => ctx.github.write(reviewArgs(repo, number, event, body.trim() ? body : ""), { repo }), ctx);
    return { ok: true };
  },
} satisfies Op;
