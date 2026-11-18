// The page's rows from the lists of every working server: a pull request once, with where it is on each working server
// that listed it (the clone of its repository there, and its worktree), so that one with a worktree anywhere opens
// there. One without a clone on any working server cannot get a worktree, and is left out.
import { SEARCH_LIMIT, type Cleanup, type Listing, type PrRow, type PrWorktree } from "./types.ts";

export interface Spot<M> {
  machine: M;
  primary: string;
  worktree?: PrWorktree;
  cleanup?: Cleanup;
  reviewSessions?: string[];
}

export interface Item<M> {
  pr: Omit<PrRow, "place">;
  spots: Spot<M>[];
}

/** The pull requests of one repository in the lower part of the page. */
export interface Group<M> {
  repo: string;
  /** Watched on some working server; otherwise it is here for the review worktrees of its pull requests. */
  watched: boolean;
  items: Item<M>[];
}

export interface PageItems<M> {
  requested: Item<M>[];
  groups: Group<M>[];
  requestedMore: number;
  watchedMore: number;
}

/**
 * Lists each in order, as one list in that order: of those ranked the same, or without a rank to compare, the earlier
 * list's comes first.
 */
export function mergeOrdered<T>(lists: readonly (readonly T[])[], rank: (x: T) => number | undefined): T[] {
  const at = lists.map(() => 0);
  const out: T[] = [];
  for (;;) {
    let from = -1;
    let best: T | undefined;
    for (const [k, list] of lists.entries()) {
      const i = at[k] ?? 0;
      if (i >= list.length) continue;
      const x = list[i] as T;
      const r = rank(x);
      const b = best === undefined ? undefined : rank(best);
      if (from < 0 || (r !== undefined && b !== undefined && r < b)) {
        from = k;
        best = x;
      }
    }
    if (from < 0) return out;
    out.push(best as T);
    at[from] = (at[from] ?? 0) + 1;
  }
}

export function pageItems<M>(lists: { machine: M; listing: Listing }[]): PageItems<M> {
  // Every working server's spot of a pull request, whichever part of the page listed it there.
  const spots = new Map<string, Spot<M>[]>();
  for (const { machine, listing } of lists) {
    for (const pr of [...listing.requested, ...listing.repos.flatMap((r) => r.prs)]) {
      if (!pr.place) continue;
      const all = spots.get(pr.url) ?? [];
      if (!all.some((s) => s.machine === machine)) all.push({ machine, ...pr.place });
      spots.set(pr.url, all);
    }
  }
  const item = ({ place: _, ...pr }: PrRow): Item<M> => ({ pr, spots: spots.get(pr.url) ?? [] });
  const once = (prs: PrRow[]): Item<M>[] => {
    const seen = new Set<string>();
    return prs
      .filter((p) => !seen.has(p.url) && Boolean(seen.add(p.url)))
      .map(item)
      .filter((i) => i.spots.length > 0);
  };
  const groups = new Map<string, { repo: string; watched: boolean; prs: PrRow[] }>();
  for (const { listing } of lists) {
    for (const r of listing.repos) {
      const key = r.repo.toLowerCase();
      const g = groups.get(key) ?? { repo: r.repo, watched: false, prs: [] };
      g.watched ||= r.watched;
      g.prs.push(...r.prs);
      groups.set(key, g);
    }
  }
  // Working servers watch different repositories, so each lists some of mine the others do not.
  const requested = once(mergeOrdered(lists.map((l) => l.listing.requested), (p) => p.order));
  return {
    requested: requested.slice(0, SEARCH_LIMIT),
    // The watched repositories first, as their working servers list them.
    groups: [...groups.values()].sort((a, b) => Number(b.watched) - Number(a.watched)).map((g) => ({ repo: g.repo, watched: g.watched, items: once(g.prs) })),
    requestedMore: Math.max(0, ...lists.map((l) => l.listing.requestedMore ?? 0)) + Math.max(0, requested.length - SEARCH_LIMIT),
    watchedMore: lists.reduce((n, l) => n + (l.listing.watchedMore ?? 0), 0),
  };
}

/**
 * What "まとめてレビューさせる" makes on one working server: the open pull requests with no worktree on any working server
 * (one with a worktree somewhere is being reviewed already) and a clone on this one, each with its spot here. A search
 * without `is:open` lists merged and closed ones too: they have nothing left to review. One from a fork is left out: its
 * code is someone else's, so a session is started for it only from its own row, one at a time.
 */
export function batchTargets<M>(items: Item<M>[], machine: M): { item: Item<M>; spot: Spot<M> }[] {
  return items.flatMap((item) => {
    if (item.pr.state !== "open" || item.pr.fork || item.spots.some((s) => s.worktree)) return [];
    const spot = item.spots.find((s) => s.machine === machine);
    return spot ? [{ item, spot }] : [];
  });
}
