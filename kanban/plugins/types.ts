// What a board plugin (kanban/plugins/<name>/index.ts) gets and gives. The kanban's web part calls its `state` for each
// card of the repositories that chose it in "見る repo", and puts the card in the column it gives.
import type { KanbanCard, KanbanColumn } from "../src/cards.ts";

export type { KanbanColumn };

/** A card as `state` gets it: what the card shows, before it has a column. */
export type StateCard = Omit<KanbanCard, "column" | "reason">;

/** Where `state` puts a card. */
export interface Placement {
  column: KanbanColumn;
  /** Why, in a few words: shown on the card. */
  reason?: string;
}

/**
 * What index.ts exports as `state`. It runs in the browser for every card each time the board is drawn, so it only
 * looks at the card: no network, no timers. A card whose `state` throws or gives an unknown column goes in "mine".
 */
export type State = (card: StateCard) => Placement;
