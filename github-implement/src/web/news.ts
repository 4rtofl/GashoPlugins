// The numbers on the worktree tabs of the items the background reads: the comments, reviews and finished checks that
// came since each tab was last open (ops/news.ts). While an item's screen is open, its tab has none; once the screen
// has told the daemon part what it showed (item/sections/seen.tsx), the numbers are read again, so that the one of the
// tab that opened goes away.
import { useEffect } from "react";
import { usePluginState, useRequest, useSetting, type RequestOptions } from "@gasho/plugin-sdk";
import { newsCount, type ItemNews } from "../news.ts";
import type { ItemSummary, WorktreeItems } from "../types.ts";
import { readOp } from "./daemon.ts";

/** Plugin state: owner/name#number of the item whose screen is open. */
export const OPEN_KEY = "news:open";
/** Plugin state: grows every time a screen has told the daemon part what it showed. */
export const SEEN_KEY = "news:seen";

/** What the background reads again (src/daemon/index.ts): the issue the branch is named after and its open pull requests. */
export function watchedItems(items: WorktreeItems): ItemSummary[] {
  const seen = new Set<number>();
  return [...(items.named ? [items.named] : []), ...items.pulls].filter((i) => i.state === "open" && !seen.has(i.number) && Boolean(seen.add(i.number)));
}

/** "コメント 2・終わったチェック 3" */
export function newsText(n: ItemNews): string {
  const parts: [string, number][] = [
    ["コメント", n.comments],
    ["レビュー", n.reviews],
    ["終わったチェック", n.checks],
  ];
  return parts
    .filter(([, c]) => c > 0)
    .map(([what, c]) => `${what} ${c}`)
    .join("・");
}

/** The news of the worktree's items, by number; none for the item whose screen is open. */
export function useNews(machine: string, repo: string | undefined, items: WorktreeItems | undefined, options: RequestOptions): Map<number, ItemNews> {
  const [refresh] = useSetting<number>("refreshSeconds");
  const [open] = usePluginState<string | undefined>(OPEN_KEY, undefined);
  const [seen] = usePluginState(SEEN_KEY, 0);
  const watched = items ? watchedItems(items) : [];
  const target = repo && watched.length > 0 && refresh !== 0 ? readOp(machine, "news", { repo, items: watched.map((i) => ({ kind: i.kind, number: i.number })) }) : undefined;
  const r = useRequest<Record<string, ItemNews>>(target, options);
  const { reload } = r;
  useEffect(() => {
    if (seen > 0) reload();
  }, [seen, reload]);
  const news = new Map<number, ItemNews>();
  for (const [n, v] of Object.entries(r.data ?? {})) {
    const number = Number(n);
    if (newsCount(v) > 0 && `${repo}#${number}` !== open) news.set(number, v);
  }
  return news;
}
