// What a board plugin (kanban/plugins/<name>/index.ts) gets and gives. The kanban's web part calls its `state` for each
// card of the repositories that chose it in "見る repo", puts the card in the column it gives, and lists the
// instructions it gives on the card's menu.
import type { CardAction, KanbanCard, KanbanColumn } from "../src/cards.ts";

export type { CardAction, KanbanColumn };

/** A card as `state` gets it: what the card shows, before it has a column. */
export type StateCard = Omit<KanbanCard, "column" | "reason" | "actions">;

/** Where `state` puts a card. */
export interface Placement {
  column: KanbanColumn;
  /** Why, in a few words: shown on the card. */
  reason?: string;
  /**
   * The instructions on the card's menu, in this order. Pressing one sends its `text` to the worktree's Gasho session
   * used last, or to one started there when it has none.
   */
  actions?: CardAction[];
}

/**
 * What index.ts exports as `state`. It runs in the browser for every card each time the board is drawn, so it only
 * looks at the card: no network, no timers. A card whose `state` throws, gives an unknown column, or gives instructions
 * without a label or a text goes in "mine", with no instructions.
 */
export type State = (card: StateCard) => Placement;
