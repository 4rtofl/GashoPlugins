// What both parts of github-implement share about an item's news: the latest comment, review and finished check its
// screen showed while its tab was open (the marks), and what came after them, which the item's worktree tab counts.
import type { GitHubItemDetail, ItemSummary, WorktreeItems } from "./types.ts";

/** The latest comment, review and finished check of an item that its screen showed (ISO 8601 each); absent: none. */
export interface SeenMarks {
  comment?: string;
  review?: string;
  check?: string;
}

/** What came after the marks. */
export interface ItemNews {
  comments: number;
  reviews: number;
  checks: number;
}

type Read = Pick<GitHubItemDetail, "comments" | "reviews" | "checksFinishedAt">;

const KEYS = ["comment", "review", "check"] as const;

// Marks come from a browser and from a file too.
const time = (s: unknown): number => (typeof s === "string" ? Date.parse(s) : NaN);

function latest(times: (string | undefined)[]): string | undefined {
  let best: string | undefined;
  for (const t of times) if (!Number.isNaN(time(t)) && (best === undefined || time(t) > time(best))) best = t;
  return best;
}

export function marksOf(item: Read): SeenMarks {
  const marks: SeenMarks = {
    comment: latest((item.comments ?? []).map((c) => c.createdAt)),
    review: latest((item.reviews ?? []).map((r) => r.submittedAt)),
    check: latest(item.checksFinishedAt ?? []),
  };
  for (const k of KEYS) if (marks[k] === undefined) delete marks[k];
  return marks;
}

/** The later of each mark: what a screen showed once stays seen, though a screen with an older read tells it after. */
export function laterMarks(a: SeenMarks, b: SeenMarks): SeenMarks {
  const marks: SeenMarks = {};
  for (const k of KEYS) {
    const m = latest([a[k], b[k]]);
    if (m !== undefined) marks[k] = m;
  }
  return marks;
}

/** What the item has after the marks. A mark that is absent was none: then everything of its kind is new. */
export function newsOf(item: Read, seen: SeenMarks): ItemNews {
  const after = (mark: string | undefined) => (t: string) => !Number.isNaN(time(t)) && (mark === undefined || time(t) > time(mark));
  return {
    comments: (item.comments ?? []).map((c) => c.createdAt).filter(after(seen.comment)).length,
    reviews: (item.reviews ?? []).map((r) => r.submittedAt).filter(after(seen.review)).length,
    checks: (item.checksFinishedAt ?? []).filter(after(seen.check)).length,
  };
}

export const newsCount = (n: ItemNews): number => n.comments + n.reviews + n.checks;

/**
 * The items whose news the worktree tab counts, which the daemon part reads again in the background (src/daemon/index.ts),
 * so that the screen's reads of them are what gasho-daemon kept of the background's: the issue the branch is named
 * after and the branch's open pull requests, each once.
 */
export function watchedItems(items: WorktreeItems): ItemSummary[] {
  const seen = new Set<number>();
  return [...(items.named ? [items.named] : []), ...items.pulls].filter((i) => i.state === "open" && !seen.has(i.number) && Boolean(seen.add(i.number)));
}
