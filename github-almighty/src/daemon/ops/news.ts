// What came since an item's tab was last open, for the number on its worktree tab: { repo, items: [{ kind, number }],
// fresh? } → { [number]: ItemNews }, only the items with some. The screen asks it for the items the background reads
// (the issue the branch is named after and the branch's open pull requests), so that their reads are what gasho-daemon
// kept of the background's, and nothing when the background reads are off (refreshSeconds 0). An item it has not met
// before starts with nothing new: what it has then counts as seen.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import type { GitHubKind } from "../../types.ts";
import { marksOf, newsCount, newsOf, type ItemNews } from "../../news.ts";
import { maxAge, readDetail, refreshSeconds } from "../core.ts";
import { kindArg, numberArg, objArg, repoArg } from "../gh.ts";
import type { Op } from "../op.ts";
import { seenKey, seenStore } from "../seen.ts";

function itemsArg(v: unknown): { kind: GitHubKind; number: number }[] {
  if (!Array.isArray(v) || v.length > 20) throw new PluginError("Issue と Pull request の指定が正しくありません。");
  return v.map((i) => ({ kind: kindArg(objArg(i).kind), number: numberArg(objArg(i).number) }));
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const items = itemsArg(p.items);
    if (refreshSeconds() === 0) return {};
    const store = seenStore(ctx.dataDir);
    const news: Record<string, ItemNews> = {};
    await Promise.all(
      items.map(async ({ kind, number }) => {
        let item;
        try {
          item = await readDetail(ctx, repo, kind, number, maxAge(p));
        } catch (e) {
          // The item's screen says why; its tab just has no number.
          ctx.log(`could not read the news of ${repo}#${number}`, e);
          return;
        }
        const key = seenKey(repo, number);
        const seen = await store.get(key);
        if (!seen) return store.mark(key, marksOf(item), Date.now());
        const n = newsOf(item, seen);
        if (newsCount(n) > 0) news[number] = n;
      }),
    );
    return news;
  },
} satisfies Op;
