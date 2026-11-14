// What a board plugin (kanban/plugins/<name>/index.ts) gets and gives. The kanban's daemon part calls its `fetch` for
// each repository that chose it in "見る repo", for what the cards do not have; the web part calls its `state` for each
// card of those repositories, with what `fetch` gave, puts the card in the column it gives, and lists the instructions
// it gives on the card's menu.
import type { DaemonGitHub } from "@gasho/plugin-sdk/daemon";
import type { CardAction, KanbanCard, KanbanColumn } from "../src/cards.ts";
import type { RepoMaterial } from "../src/types.ts";

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
 * looks at the card and at what `fetch` gave for its repository (undefined until `fetch` first gives something, and
 * without a `fetch`): no network, no timers. A card whose `state` throws, gives an unknown column, or gives instructions
 * without a label or a text goes in "mine", with no instructions.
 */
export type State<T = unknown> = (card: StateCard, fetched: T | undefined) => Placement;

/** A repository as `fetch` gets it: what the kanban has just read of it. */
export type FetchRepo = Omit<RepoMaterial, "plugin" | "fetched">;

export interface FetchContext {
  /** gh of the working server, run by gasho-daemon (ctx.github.read of the plugin SDK): name the repository with --repo. */
  github: Pick<DaemonGitHub, "read">;
}

/**
 * What index.ts may export as `fetch`. It runs in gasho-daemon of the working server, for each repository, at most
 * every other reading of the board (and on "今すぐ見直す"), and gives what `state` gets: JSON, up to 256 KB.
 */
export type Fetch<T = unknown> = (repo: FetchRepo, ctx: FetchContext) => Promise<T>;
