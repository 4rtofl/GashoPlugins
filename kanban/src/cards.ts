// The kanban's cards (moved here from Gasho's apps/daemon/src/kanban.ts and apps/web/src/lib/kanban.ts of PR #8): a card
// for each worktree of a watched repository, with its branch's pull request and the Claude Code sessions in it, and one
// for each open pull request of mine without a worktree. The web part makes them from what the daemon part read
// (Board) and the sessions of the working server (MachineInfo.sessions, Gasho's and the others alike). The board plugin
// chosen for the repository decides each card's column (kanban/plugins/); without one, every card goes in the first
// column. No React here, so that the tests run it as it is.
import type { MachineInfo, SessionInfo } from "@gasho/plugin-sdk";
import type { StateCard } from "../plugins/types.ts";
import type { Board, ClosedPr, OpenPr, RepoMaterial } from "./types.ts";

/** The columns, in their order: my move, the agent works, GitHub works (CI), the reviewers' move, done. */
export type KanbanColumn = "mine" | "agent" | "github" | "review" | "done";

export const KANBAN_COLUMNS: { id: KanbanColumn; label: string }[] = [
  { id: "mine", label: "自分の番" },
  { id: "agent", label: "エージェント作業中" },
  { id: "github", label: "GitHub 待ち" },
  { id: "review", label: "レビュー待ち" },
  { id: "done", label: "完了" },
];

type SessionStatus = SessionInfo["status"];

/** A Claude Code session working in a card's worktree: any session on the working server, not only Gasho's. */
export interface CardSession {
  sessionId: string;
  status: SessionStatus;
  /** Started by Gasho, so the card can open it. */
  managed?: boolean;
}

/** A session as the cards read it. */
export interface SessionLike extends CardSession {
  cwd: string;
}

/** One worktree with its branch's pull request, or an open pull request of mine without a worktree. */
export interface KanbanCard {
  /** Unique on its working server. */
  id: string;
  /** OWNER/REPO */
  repo: string;
  /** The worktree's folder name; "PR #12" for a pull request without a worktree. */
  label: string;
  path?: string;
  branch?: string;
  /** The repository's primary checkout, shown only while it has an open pull request or a session needs it. */
  primary?: boolean;
  /** The pull request's title, or else the branch. */
  title: string;
  /** The issue number in the branch name (feat/12-x → 12). */
  issue?: number;
  /** The open pull request of the branch, or else its latest closed one. */
  pr?: { number: number; url: string; state: "open" | "merged" | "closed"; draft?: boolean };
  /** When the open pull request last changed (ISO 8601). */
  updatedAt?: string;
  column: KanbanColumn;
  /** Why the card is in its column, as the board plugin said; `error` when it could not tell (the card is in "mine"). */
  reason?: { text: string; error?: string };
  sessions: CardSession[];
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

/** The board plugins built in, by their folder's name: what each kanban/plugins/<name>/index.ts exports. */
export type BoardPlugins = ReadonlyMap<string, { state?: unknown }>;

const COLUMN_IDS = new Set<string>(KANBAN_COLUMNS.map((c) => c.id));

/** Where the board plugin `name` puts a card: "mine" without one, and when it fails. */
export function placeCard(card: StateCard, name: string | undefined, plugins: BoardPlugins): Pick<KanbanCard, "column" | "reason"> {
  if (name === undefined) return { column: "mine" };
  const failed = (error: string) => ({ column: "mine" as const, reason: { text: `列を決められませんでした（${name}）`, error } });
  const state = plugins.get(name)?.state;
  if (typeof state !== "function") return failed(plugins.has(name) ? "index.ts が state を export していません。" : `kanban/plugins/${name}/ が、このビルドにありません。`);
  let placed: unknown;
  try {
    placed = state(card);
  } catch (e) {
    return failed(`state が失敗しました：${e instanceof Error ? e.message : String(e)}`);
  }
  const { column, reason } = (placed ?? {}) as { column?: unknown; reason?: unknown };
  if (typeof column !== "string" || !COLUMN_IDS.has(column)) return failed(`state が知らない列を返しました：${String(column)}`);
  const text = typeof reason === "string" ? reason.trim() : "";
  return { column: column as KanbanColumn, ...(text ? { reason: { text } } : {}) };
}

const cardSession = (s: SessionLike): CardSession => ({ sessionId: s.sessionId, status: s.status, ...(s.managed ? { managed: true } : {}) });

/**
 * The cards of one repository: its worktrees, its primary checkout while it has an open pull request or a session
 * there works or awaits an answer (work on main is not missed), and my open pull requests without a worktree.
 */
export function cardsOf(m: RepoMaterial, byPath: Map<string, SessionLike[]>, plugins: BoardPlugins): KanbanCard[] {
  const open = new Map(m.prs.map((p) => [p.headRefName, p]));
  const closedOf = new Map(m.closed.map((p) => [p.headRefName, p]));
  const trees: { branch?: string; path: string; primary: boolean }[] = m.worktrees.map((w) => ({ branch: w.branch, path: w.path, primary: false }));
  trees.push({ branch: m.primary.branch, path: m.primary.path, primary: true });
  const cards: KanbanCard[] = [];
  const card = (t: { branch?: string; path?: string; primary: boolean }, pr: OpenPr | undefined, closed: ClosedPr | undefined, sessions: SessionLike[]) => {
    const shown = pr ?? closed;
    const issue = issueOf(t.branch);
    const base: StateCard = {
      // A pull request without a worktree shows once per clone of its repository, so the clone is part of its id.
      id: `${m.repo}:${t.path ?? `${m.primary.path}#pr-${pr?.number}`}`,
      repo: m.repo,
      label: t.path ? basename(t.path) : `PR #${pr?.number}`,
      ...(t.path ? { path: t.path } : {}),
      ...(t.branch ? { branch: t.branch } : {}),
      ...(t.primary ? { primary: true } : {}),
      title: shown?.title || t.branch || basename(t.path ?? ""),
      ...(issue !== undefined ? { issue } : {}),
      ...(pr
        ? { pr: { number: pr.number, url: pr.url, state: "open" as const, ...(pr.isDraft ? { draft: true } : {}) } }
        : closed
          ? { pr: { number: closed.number, url: closed.url, state: closed.state === "MERGED" ? ("merged" as const) : ("closed" as const) } }
          : {}),
      ...(pr?.updatedAt ? { updatedAt: pr.updatedAt } : {}),
      sessions: sessions.map(cardSession),
    };
    cards.push({ ...base, ...placeCard(base, m.plugin, plugins) });
  };
  for (const t of trees) {
    const pr = t.branch === undefined ? undefined : open.get(t.branch);
    const sessions = byPath.get(t.path) ?? [];
    if (t.primary && !pr && !sessions.some((s) => s.status === "busy" || s.status === "waiting")) continue;
    card(t, pr, pr || t.branch === undefined ? undefined : closedOf.get(t.branch), sessions);
  }
  const taken = new Set(trees.map((t) => t.branch));
  for (const pr of m.prs) if (!taken.has(pr.headRefName)) card({ branch: pr.headRefName, primary: false }, pr, undefined, []);
  return cards;
}

/** The cards of one working server's board, with its sessions as they are now. */
export function boardCards(machine: MachineInfo, board: Board, plugins: BoardPlugins): KanbanCard[] {
  const live: SessionLike[] = machine.sessions
    .filter((s) => s.status !== "unknown")
    .map((s) => ({ sessionId: s.sessionId, cwd: s.cwd, status: s.status, ...(s.managed ? { managed: true } : {}) }));
  // Across the repositories at once: a session in a repository inside another one goes to the inner one only.
  const byPath = assignSessions(
    live,
    board.repos.flatMap((m) => [m.primary.path, ...m.worktrees.map((w) => w.path)]),
  );
  return board.repos.flatMap((m) => cardsOf(m, byPath, plugins));
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

/** The cards of the connected working servers. */
export function kanbanCards(boards: { machine: MachineInfo; board: Board }[], plugins: BoardPlugins): PlacedCard[] {
  return sortCards(
    boards.filter((b) => b.machine.connected).flatMap(({ machine, board }) => boardCards(machine, board, plugins).map((card) => ({ machine, card }))),
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
