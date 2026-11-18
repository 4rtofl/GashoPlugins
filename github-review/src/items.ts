// The page's rows from the lists of every working server: a pull request once, with where it is on each working server
// that listed it (the clone of its repository there, and its worktree), so that one with a worktree anywhere opens
// there. One without a clone on any working server cannot get a worktree, and is left out (the page says how many).
// Each part shows at most SEARCH_LIMIT, the newest of every working server's, and counts the rest once however many
// working servers watch a repository.
import { inOrder } from "./search.ts";
import { SEARCH_LIMIT, type Cleanup, type Listing, type PrRow, type PrWorktree } from "./types.ts";

export interface Spot<M> {
  machine: M;
  primary: string;
  worktree?: PrWorktree;
  cleanup?: Cleanup;
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
  /** Those the search found, then those kept for their review worktree. */
  items: Item<M>[];
  /** Watched: how many GitHub found for the search words. */
  total: number;
}

export interface PageItems<M> {
  requested: Item<M>[];
  /** Of those read for the upper part, how many are left out as no working server has a clone of their repository. */
  requestedNoClone: number;
  /** How many GitHub found for the upper part that were not read (whether they have a clone is not known). */
  requestedMore: number;
  groups: Group<M>[];
  /** How many GitHub found for the watched repositories that the lower part does not show. */
  watchedMore: number;
}

const once = (prs: PrRow[]): PrRow[] => {
  const seen = new Set<string>();
  return prs.filter((p) => !seen.has(p.url) && Boolean(seen.add(p.url)));
};

/** The page's rows; `words` are the search words, whose order the lower part keeps. */
export function pageItems<M>(lists: { machine: M; listing: Listing }[], words: string): PageItems<M> {
  // Every working server's spot of a pull request, whichever part of the page listed it there.
  const spots = new Map<string, Spot<M>[]>();
  for (const { machine, listing } of lists) {
    for (const pr of [...listing.requested, ...listing.repos.flatMap((r) => [...r.prs, ...r.kept])]) {
      if (!pr.place) continue;
      const all = spots.get(pr.url) ?? [];
      if (!all.some((s) => s.machine === machine)) all.push({ machine, ...pr.place });
      spots.set(pr.url, all);
    }
  }
  const item = ({ place: _, ...pr }: PrRow): Item<M> => ({ pr, spots: spots.get(pr.url) ?? [] });
  const placed = (prs: PrRow[]): Item<M>[] => prs.map(item).filter((i) => i.spots.length > 0);

  // Every working server reads the same search for the upper part.
  const read = once(lists.flatMap((l) => l.listing.requested));
  const requested = placed(read);
  const requestedTotal = Math.max(0, ...lists.map((l) => l.listing.requestedTotal));

  const groups = new Map<string, { repo: string; watched: boolean; prs: PrRow[]; kept: PrRow[]; total: number }>();
  for (const { listing } of lists) {
    for (const r of listing.repos) {
      const key = r.repo.toLowerCase();
      const g = groups.get(key) ?? { repo: r.repo, watched: false, prs: [], kept: [], total: 0 };
      g.watched ||= r.watched;
      g.prs.push(...r.prs);
      g.kept.push(...r.kept);
      // Working servers that watch it read the same search.
      g.total = Math.max(g.total, r.total);
      groups.set(key, g);
    }
  }
  // The watched repositories first, as their working servers list them.
  const ordered = [...groups.values()].sort((a, b) => Number(b.watched) - Number(a.watched));
  const found = inOrder(once(ordered.flatMap((g) => g.prs)), words).slice(0, SEARCH_LIMIT);
  const foundUrls = new Set(ordered.flatMap((g) => g.prs.map((p) => p.url)));
  return {
    requested,
    requestedNoClone: read.length - requested.length,
    requestedMore: Math.max(0, requestedTotal - read.length),
    groups: ordered.map((g) => {
      const key = g.repo.toLowerCase();
      return {
        repo: g.repo,
        watched: g.watched,
        items: placed([...found.filter((p) => p.repo.toLowerCase() === key), ...once(g.kept).filter((p) => !foundUrls.has(p.url))]),
        total: g.total,
      };
    }),
    watchedMore: Math.max(0, ordered.reduce((n, g) => n + g.total, 0) - found.length),
  };
}
