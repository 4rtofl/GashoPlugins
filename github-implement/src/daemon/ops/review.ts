// A review of a pull request: { repo, number, event: "approve" | "request_changes" | "comment", body? }. A comment and a
// request for changes need a body. GitHub refuses the author's own approval and request for changes.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh, withTextFile } from "../core.ts";
import { numberArg, repoArg, textArg } from "../gh.ts";
import type { Op } from "../op.ts";

const EVENTS = { approve: "--approve", request_changes: "--request-changes", comment: "--comment" } as const;

export type ReviewEvent = keyof typeof EVENTS;

/** `bodyFile`: a file with the review's text (withTextFile); none for an approval without one. */
export const reviewArgs = (repo: string, number: number, event: ReviewEvent, bodyFile?: string): string[] => ["pr", "review", String(number), "--repo", repo, EVENTS[event], ...(bodyFile ? [`--body-file=${bodyFile}`] : [])];

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    if (typeof p.event !== "string" || !Object.hasOwn(EVENTS, p.event)) throw new PluginError("レビューの種類の指定が正しくありません。");
    const event = p.event as ReviewEvent;
    const body = p.body === undefined ? "" : textArg(p.body, "レビューの本文", 65_536);
    if (event !== "approve" && !body.trim()) throw new PluginError("コメントと修正の依頼には、本文が要ります。");
    const review = (bodyFile?: string) => ctx.github.write(reviewArgs(repo, number, event, bodyFile), { repo });
    await gh(`review #${number}`, () => (body.trim() ? withTextFile(body, review) : review()), ctx);
    return { ok: true };
  },
} satisfies Op;
