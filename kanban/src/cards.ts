// The kanban's cards (moved here from Gasho's apps/daemon/src/kanban.ts and apps/web/src/lib/kanban.ts of PR #8): a card
// for each worktree of a watched repository, with its branch's pull request and the Claude Code sessions in it, and one
// for each open pull request of mine without a worktree. The web part makes them from what the daemon part read
// (Board) and the sessions of the working server (MachineInfo.sessions, Gasho's and the others alike). The board plugin
// chosen for the repository decides each card's column, the marks on it and the instructions on its menu, and the
// headings above the board (the working server's folder of board plugins, kanban/plugins/ of this repository at
// first); without one, every card goes in the first column. No React here, so that the tests run it as it is.
import type { MachineInfo } from "@gasho/plugin-sdk";
import { headingsWith, KANBAN_COLUMNS, placeWith } from "../plugins/place.ts";
import type { BoardHeading, CardAction, CardMark, CardSession, KanbanColumn, StateCard } from "../plugins/types.ts";
import type { Board, ClosedPr, OpenPr, RepoMaterial, ReviewPr } from "./types.ts";

export { KANBAN_COLUMNS };
export type { BoardHeading, CardAction, CardMark, CardSession, KanbanColumn };

/** A session as the cards read it. */
export interface SessionLike extends CardSession {
  cwd: string;
}

/** A card on the board: what `state` gets, and where it put it. */
export interface KanbanCard extends StateCard {
  column: KanbanColumn;
  /** Why the card is in its column, as the board plugin said; `error` when it could not tell (the card is in "mine"). */
  reason?: { text: string; error?: string };
  /** The instructions the board plugin gave for the card's menu. */
  actions?: CardAction[];
  /** The marks the board plugin put on the card. */
  marks?: CardMark[];
}

export interface PlacedCard {
  machine: MachineInfo;
  card: KanbanCard;
}

/** A number between separators (/ - _ #), so versions such as release/2.1 are not taken for an issue. */
const ISSUE_NUMBER = /(?:^|[/_#-])(\d+)(?=$|[/_-])/;

export function issueOf(branch: string | undefined): number | undefined {
  const m = ISSUE_NUMBER.exec(branch ?? "");
  return m?.[1] ? Number(m[1]) : undefined;
}

const basename = (p: string): string => p.replace(/\/+$/, "").split("/").pop() || p;

/** Each session goes to the deepest of `paths` that holds its folder; sessions outside all of them are left out. */
export function assignSessions(sessions: readonly SessionLike[], paths: readonly string[]): Map<string, SessionLike[]> {
  const deepestFirst = [...new Set(paths)].sort((a, b) => b.length - a.length);
  const out = new Map<string, SessionLike[]>();
  for (const s of sessions) {
    const p = deepestFirst.find((d) => s.cwd === d || s.cwd.startsWith(`${d.replace(/\/+$/, "")}/`));
    if (p) out.set(p, [...(out.get(p) ?? []), s]);
  }
  return out;
}

/**
 * A working server's board plugins, by their folder's name, as the web part loaded them: what each index.ts exports, or
 * why it cannot be used.
 */
export type BoardPlugins = ReadonlyMap<string, { state?: unknown; headings?: unknown; error?: string }>;

/**
 * Where the board plugin `name` puts a card, the marks it puts on it and what its menu sends, with what its `fetch`
 * gave: "mine" and nothing without one, and when it fails.
 */
export function placeCard(card: StateCard, name: string | undefined, plugins: BoardPlugins, fetched?: unknown): Pick<KanbanCard, "column" | "reason" | "marks" | "actions"> {
  if (name === undefined) return { column: "mine" };
  const plugin = plugins.get(name);
  const placed = plugin === undefined ? { error: `置き場に ${name}/index.ts がありません。` } : plugin.error !== undefined ? { error: plugin.error } : placeWith(plugin.state, card, fetched);
  if ("error" in placed) return { column: "mine", reason: { text: `列を決められませんでした（${name}）`, error: placed.error } };
  const { reason, ...rest } = placed;
  return { ...rest, ...(reason ? { reason: { text: reason } } : {}) };
}

/** The headings above the board from one repository's board plugin; `error` (and no headings) when it failed. */
export interface RepoHeadings {
  machine: MachineInfo;
  repo: string;
  plugin: string;
  headings: BoardHeading[];
  error?: string;
}

/** The headings the board plugins of the connected working servers' repositories give, with what their `fetch` gave. */
export function boardHeadings(boards: { machine: MachineInfo; board: Board; plugins: BoardPlugins }[]): RepoHeadings[] {
  return boards
    .filter((b) => b.machine.connected)
    .flatMap(({ machine, board, plugins }) =>
      board.repos.flatMap((m): RepoHeadings[] => {
        const plugin = m.plugin;
        const loaded = plugin === undefined ? undefined : plugins.get(plugin);
        if (plugin === undefined || typeof loaded?.headings !== "function") return [];
        const { plugin: _, fetched, ...repo } = m;
        const shown = headingsWith(loaded.headings, repo, fetched);
        return "error" in shown ? [{ machine, repo: m.repo, plugin, headings: [], error: shown.error }] : [{ machine, repo: m.repo, plugin, headings: shown }];
      }),
    );
}

const cardSession = (s: SessionLike): CardSession => ({ sessionId: s.sessionId, status: s.status, ...(s.managed ? { managed: true } : {}) });

/** A pull request as a card shows it. */
interface ShownPr {
  pr: NonNullable<StateCard["pr"]>;
  title: string;
  updatedAt?: string;
}

const openShown = (p: OpenPr): ShownPr => ({
  pr: { number: p.number, url: p.url, state: "open", ...(p.isDraft ? { draft: true } : {}) },
  title: p.title,
  ...(p.updatedAt ? { updatedAt: p.updatedAt } : {}),
});

const closedShown = (p: ClosedPr): ShownPr => ({ pr: { number: p.number, url: p.url, state: p.state === "MERGED" ? "merged" : "closed" }, title: p.title });

const reviewShown = (p: ReviewPr): ShownPr => ({
  pr: { number: p.number, url: p.url, state: p.state, ...(p.isDraft ? { draft: true } : {}) },
  title: p.title,
  ...(p.updatedAt ? { updatedAt: p.updatedAt } : {}),
});

/**
 * The cards of one repository as its board plugin's `state` gets them: its worktrees, its primary checkout while it has
 * an open pull request or a session there works or awaits an answer (work on main is not missed), and my open pull
 * requests without a worktree. A worktree gets the pull request of its branch only from this repository (a fork's
 * branch of the same name is another one), and a closed one only while it is on that pull request's last commit (a
 * new worktree on the branch of a pull request merged before is new work); a review worktree, the one it is for.
 */
export function stateCardsOf(m: RepoMaterial, byPath: Map<string, SessionLike[]>): StateCard[] {
  const open = new Map(m.prs.filter((p) => !p.isCrossRepository).map((p) => [p.headRefName, p]));
  const closedOf = new Map(m.closed.map((p) => [p.headRefName, p]));
  const reviews = new Map((m.reviews ?? []).map((r) => [r.path, r]));
  const trees: { branch?: string; path: string; head?: string; primary: boolean }[] = m.worktrees.map((w) => ({ ...w, primary: false }));
  trees.push({ ...m.primary, primary: true });
  const cards: StateCard[] = [];
  const card = (t: { branch?: string; path?: string; primary: boolean }, shown: ShownPr | undefined, sessions: SessionLike[], review = false) => {
    const issue = issueOf(t.branch);
    cards.push({
      // A pull request without a worktree shows once per clone of its repository, so the clone is part of its id.
      id: `${m.repo}:${t.path ?? `${m.primary.path}#pr-${shown?.pr.number}`}`,
      repo: m.repo,
      label: t.path ? basename(t.path) : `PR #${shown?.pr.number}`,
      ...(t.path ? { path: t.path } : {}),
      ...(t.branch ? { branch: t.branch } : {}),
      ...(t.primary ? { primary: true } : {}),
      title: shown?.title || t.branch || basename(t.path ?? ""),
      ...(issue !== undefined ? { issue } : {}),
      ...(shown ? { pr: shown.pr } : {}),
      ...(review ? { review: true as const } : {}),
      ...(shown?.updatedAt ? { updatedAt: shown.updatedAt } : {}),
      sessions: sessions.map(cardSession),
    });
  };
  const taken = new Set<number>();
  for (const t of trees) {
    const sessions = byPath.get(t.path) ?? [];
    const review = reviews.get(t.path);
    const pr = review || t.branch === undefined ? undefined : open.get(t.branch);
    if (t.primary && !pr && !sessions.some((s) => s.status === "busy" || s.status === "waiting")) continue;
    const closed = review || pr || t.branch === undefined ? undefined : closedOf.get(t.branch);
    const shown = review ? reviewShown(review) : pr ? openShown(pr) : closed?.headRefOid !== undefined && closed.headRefOid === t.head ? closedShown(closed) : undefined;
    if (shown) taken.add(shown.pr.number);
    card(t, shown, sessions, review !== undefined);
  }
  for (const pr of m.prs) if (!taken.has(pr.number)) card({ branch: pr.headRefName, primary: false }, openShown(pr), []);
  return cards;
}

/** The cards of one repository, where its board plugin puts them. */
export function cardsOf(m: RepoMaterial, byPath: Map<string, SessionLike[]>, plugins: BoardPlugins): KanbanCard[] {
  return stateCardsOf(m, byPath).map((c) => ({ ...c, ...placeCard(c, m.plugin, plugins, m.fetched) }));
}

/** The sessions of a working server as they are now, by the folder of the board they work in. */
function sessionsByPath(machine: MachineInfo, board: Board): Map<string, SessionLike[]> {
  const live: SessionLike[] = machine.sessions
    .filter((s) => s.status !== "unknown")
    .map((s) => ({ sessionId: s.sessionId, cwd: s.cwd, status: s.status, ...(s.managed ? { managed: true } : {}) }));
  // Across the repositories at once: a session in a repository inside another one goes to the inner one only.
  return assignSessions(
    live,
    board.repos.flatMap((m) => [m.primary.path, ...m.worktrees.map((w) => w.path)]),
  );
}

/** The cards of one working server's board, with its sessions as they are now. */
export function boardCards(machine: MachineInfo, board: Board, plugins: BoardPlugins): KanbanCard[] {
  const byPath = sessionsByPath(machine, board);
  return board.repos.flatMap((m) => cardsOf(m, byPath, plugins));
}

/** Each repository of one working server's board with its cards as `state` gets them: what "カードを書き出す" writes. */
export function boardStateCards(machine: MachineInfo, board: Board): { path: string; repo: string; cards: StateCard[] }[] {
  const byPath = sessionsByPath(machine, board);
  return board.repos.map((m) => ({ path: m.primary.path, repo: m.repo, cards: stateCardsOf(m, byPath) }));
}

const ORDER = new Map(KANBAN_COLUMNS.map((c, i) => [c.id, i]));

/** By column, and in a column the pull request that has not moved for the longest first; cards without one last. */
export function sortCards(cards: PlacedCard[]): PlacedCard[] {
  return [...cards].sort(
    (a, b) =>
      (ORDER.get(a.card.column) ?? 0) - (ORDER.get(b.card.column) ?? 0) ||
      Number(a.card.updatedAt === undefined) - Number(b.card.updatedAt === undefined) ||
      (a.card.updatedAt ?? "").localeCompare(b.card.updatedAt ?? ""),
  );
}

/** The cards of the connected working servers, each with its own board plugins. */
export function kanbanCards(boards: { machine: MachineInfo; board: Board; plugins: BoardPlugins }[]): PlacedCard[] {
  return sortCards(
    boards.filter((b) => b.machine.connected).flatMap(({ machine, board, plugins }) => boardCards(machine, board, plugins).map((card) => ({ machine, card }))),
  );
}

/**
 * Each column's width at first (they fit a 1440-wide screen beside the sidebar), and whether its cards start as one
 * line: the columns I cannot move myself, as in the personal worktree-board.
 */
export const COLUMN_DEFAULTS: Record<KanbanColumn, { width: number; compact: boolean }> = {
  mine: { width: 300, compact: false },
  agent: { width: 220, compact: false },
  github: { width: 220, compact: false },
  review: { width: 220, compact: true },
  done: { width: 200, compact: true },
};
export const COLUMN_WIDTH = { min: 180, max: 720 };

export type KanbanSortKey = "issue" | "pr" | "updated";
export interface KanbanSort {
  key: KanbanSortKey;
  desc: boolean;
}

/** The orders a column can take besides the default one; `asc` and `desc` say what each direction means. */
export const KANBAN_SORTS: Record<KanbanSortKey, { label: string; short: string; value: (c: KanbanCard) => number | undefined; asc: string; desc: string }> = {
  issue: { label: "Issue 番号", short: "Issue", value: (c) => c.issue, asc: "小さい順", desc: "大きい順" },
  pr: { label: "PR 番号", short: "PR", value: (c) => c.pr?.number, asc: "小さい順", desc: "大きい順" },
  updated: { label: "最終更新", short: "更新", value: (c) => (c.updatedAt ? Date.parse(c.updatedAt) : undefined), asc: "古い順", desc: "新しい順" },
};

/** A column's cards in `sort`; cards without the value stay below in either direction, ties keep the default order. */
export function arrangeCards(rows: PlacedCard[], sort: KanbanSort | undefined): PlacedCard[] {
  if (!sort) return rows;
  const value = KANBAN_SORTS[sort.key].value;
  return [...rows].sort((a, b) => {
    const x = value(a.card);
    const y = value(b.card);
    if (x === undefined || y === undefined) return Number(x === undefined) - Number(y === undefined);
    return sort.desc ? y - x : x - y;
  });
}
