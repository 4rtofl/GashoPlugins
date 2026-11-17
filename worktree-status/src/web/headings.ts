// 「手で決めた状態」: the sidebar's worktrees under headings the person makes on the settings screen (進行中, レビュー待ち…),
// put there by dragging their rows. The Gasho server keeps both for every browser (useSharedState): the headings in their
// order, and the heading each worktree was put in. A worktree put in none, or in a heading removed since, shows in the
// category Gasho adds at the end (「その他」).
import type { WorktreeCategory, WorktreeListContext, WorktreeMove } from "@gasho/plugin-sdk";

export interface Heading {
  /** Kept when the heading is renamed: Gasho keeps the order the person dragged the categories into, and the folding, by it. */
  id: string;
  title: string;
}

/** A worktree's key (WorktreeListWorktree.key) → the id of the heading it was put in; the one put last comes last. */
export type Placed = Record<string, string>;

/** The keys of the values on the Gasho server. */
export const HEADINGS = "headings";
export const PLACED = "placed";

/** The headings until someone changes them. */
export const DEFAULT_HEADINGS: Heading[] = [
  { id: "in-progress", title: "進行中" },
  { id: "in-review", title: "レビュー待ち" },
];

/** Gasho shows a category's title up to this many characters. */
export const MAX_TITLE = 80;

/**
 * At most this many worktrees keep their heading. A worktree removed from its disk stays in `placed`, which holds at
 * most 64 KB (about 100 bytes a worktree): past this, the ones put longest ago among those the sidebar does not list
 * are forgotten.
 */
export const MAX_PLACED = 300;

/**
 * A category per heading, in the headings' order, even an empty one: the person can drop a row only in a category that
 * shows. In each, the worktrees come in Gasho's order (the one used last first); their second line is Gasho's.
 */
export function headingCategories(headings: Heading[], placed: Placed, ctx: WorktreeListContext): WorktreeCategory[] {
  return headings.map((h) => ({
    id: h.id,
    title: h.title,
    worktrees: ctx.worktrees.filter((w) => placed[w.key] === h.id).map((w) => ({ key: w.key })),
  }));
}

/** `placed` once the person dropped a worktree's row in a heading, or in 「その他」 (`to` null). */
export function place(placed: Placed, move: WorktreeMove, listed: ReadonlySet<string>): Placed {
  const next = { ...placed };
  delete next[move.worktree];
  if (move.to === null) return next;
  next[move.worktree] = move.to;
  let over = Object.keys(next).length - MAX_PLACED;
  for (const key of Object.keys(next)) {
    if (over <= 0) break;
    if (listed.has(key)) continue;
    delete next[key];
    over--;
  }
  return next;
}

/** `placed` once a heading is removed: its worktrees go back to 「その他」. */
export function forget(placed: Placed, heading: string): Placed {
  return Object.fromEntries(Object.entries(placed).filter(([, h]) => h !== heading));
}

/** The headings with one moved up (-1) or down (1); unchanged at the end it is moved past. */
export function moveHeading(headings: Heading[], id: string, delta: -1 | 1): Heading[] {
  const i = headings.findIndex((h) => h.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= headings.length) return headings;
  const next = [...headings];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** An id that no heading has. */
export function newHeadingId(headings: Heading[]): string {
  const taken = new Set(headings.map((h) => h.id));
  let id: string;
  do id = `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  while (taken.has(id));
  return id;
}
