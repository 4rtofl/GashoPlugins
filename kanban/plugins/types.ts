// What a board plugin (kanban/plugins/<name>/index.ts) gets and gives. The kanban's daemon part calls its `fetch` for
// each repository that chose it in "見る repo", for what the cards do not have; the web part calls its `state` for each
// card of those repositories, with what `fetch` gave, puts the card in the column it gives with the marks it gives, and
// lists the instructions it gives on the card's menu; and it calls its `headings` for each of those repositories, for
// the headings above the board.
import type { DaemonGitHub, DaemonStartContext } from "@gasho/plugin-sdk/daemon";
import type { BoardHeading, CardAction, CardMark, KanbanCard, KanbanColumn } from "../src/cards.ts";
import type { RepoMaterial } from "../src/types.ts";

export type { BoardHeading, CardAction, CardMark, KanbanColumn };

/** A card as `state` gets it: what the card shows, before it has a column. */
export type StateCard = Omit<KanbanCard, "column" | "reason" | "marks" | "actions">;

/** Where `state` puts a card. */
export interface Placement {
  column: KanbanColumn;
  /** Why, in a few words: shown on the card. */
  reason?: string;
  /** Marks shown on the card, in this order (a Stack it deployed to). The one-line card shows the active ones only. */
  marks?: CardMark[];
  /**
   * The instructions on the card's menu, in this order. Pressing one sends its `text` to the worktree's Gasho session
   * used last, or to one started there when it has none.
   */
  actions?: CardAction[];
}

/**
 * What index.ts exports as `state`. It runs in the browser for every card each time the board is drawn, so it only
 * looks at the card and at what `fetch` gave for its repository (undefined until `fetch` first gives something, and
 * without a `fetch`): no network, no timers. A card whose `state` throws, gives an unknown column, marks without a text,
 * or instructions without a label or a text goes in "mine", with no marks and no instructions.
 */
export type State<T = unknown> = (card: StateCard, fetched: T | undefined) => Placement;

/** A repository as `fetch` and `headings` get it: what the kanban has just read of it. */
export type FetchRepo = Omit<RepoMaterial, "plugin" | "fetched">;

/** What `fetch` keeps for itself between its calls, for each repository: kept when gasho-daemon starts again. */
export interface FetchStore<K = unknown> {
  /** What `set` kept last for this repository (undefined before the first one). */
  get(): K | undefined;
  /** Keeps `value` (JSON, up to 256 KB) in the kanban's folder of the working server. */
  set(value: K): Promise<void>;
}

export interface FetchContext<K = unknown> {
  /** gh of the working server, run by gasho-daemon (ctx.github.read of the plugin SDK): name the repository with --repo. */
  github: Pick<DaemonGitHub, "read">;
  /** Runs a command on the working server (ctx.exec of the plugin SDK: no shell, no terminal). Use `github` for gh. */
  exec: DaemonStartContext["exec"];
  store: FetchStore<K>;
}

/**
 * What index.ts may export as `fetch`. It runs in gasho-daemon of the working server, for each repository, at most
 * every other reading of the board (and on "今すぐ見直す"), and gives what `state` and `headings` get: JSON, up to
 * 256 KB. The board is read only while it shows somewhere, so what happens while it does not is not seen.
 */
export type Fetch<T = unknown, K = unknown> = (repo: FetchRepo, ctx: FetchContext<K>) => Promise<T>;

/**
 * What index.ts may export as `headings`: for each repository that chose the plugin, the headings above the board (the
 * worktree that deployed to each Stack last). It runs in the browser each time the board is drawn, as `state` does.
 */
export type Headings<T = unknown> = (repo: FetchRepo, fetched: T | undefined) => BoardHeading[];
