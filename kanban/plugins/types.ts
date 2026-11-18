// What a board plugin (<name>/index.ts in this folder) gets and gives. The kanban's daemon part calls its `fetch` for
// each repository that chose it in "見る repo", for what the cards do not have; the web part calls its `state` for each
// card of those repositories, with what `fetch` gave, puts the card in the column it gives with the marks it gives, and
// lists the instructions it gives on the card's menu; and it calls its `headings` for each of those repositories, for
// the headings above the board. The kanban writes this file again whenever it starts: do not change it.

/** The columns: my move, the agent works, GitHub works (CI), the reviewers' move, done. */
export type KanbanColumn = "mine" | "agent" | "github" | "review" | "done";

/** A Claude Code session working in a card's worktree: any session on the working server, not only Gasho's. */
export interface CardSession {
  sessionId: string;
  /** busy: working; waiting: awaiting an answer (a question, a permission); idle: done with its turn. */
  status: "busy" | "waiting" | "idle" | "unknown";
  /** Started by Gasho, so the card can open it. */
  managed?: boolean;
}

/** A card as `state` gets it: one worktree with its branch's pull request, or an open pull request of mine without a worktree. */
export interface StateCard {
  /** Unique on its working server. */
  id: string;
  /** OWNER/REPO */
  repo: string;
  /** The worktree's folder name; "PR #12" for a pull request without a worktree. */
  label: string;
  path?: string;
  /** While a rebase stopped in the worktree, the branch it puts back. */
  branch?: string;
  /** The worktree's HEAD is detached: a rebase stopped there (`rebasing`), or a commit is checked out. */
  detached?: boolean;
  /** A rebase stopped in the worktree. */
  rebasing?: boolean;
  /** The repository's primary checkout, shown only while it has an open pull request or a session needs it. */
  primary?: boolean;
  /** The pull request's title, or else the branch. */
  title: string;
  /** The issue number in the branch name (feat/12-x → 12). */
  issue?: number;
  /**
   * My open pull request from the branch (of this repository: a fork's branch of the same name is not it), or else my
   * latest closed one from the branch when the worktree is on its last commit; on a review worktree, the pull request
   * it is for.
   */
  pr?: { number: number; url: string; state: "open" | "merged" | "closed"; draft?: boolean };
  /** A worktree github-review made to review a pull request (review-<number> beside the primary checkout), whoever opened it. */
  review?: true;
  /** When the open pull request last changed (ISO 8601). */
  updatedAt?: string;
  sessions: CardSession[];
}

/** An instruction on a card's menu: pressing it sends `text` to the worktree's Gasho session. */
export interface CardAction {
  label: string;
  text: string;
}

/** A mark on a card: a Stack the worktree deployed to last, or deploys to now. */
export interface CardMark {
  text: string;
  /** Shown when the pointer rests on the mark, and in the card's menu. */
  detail?: string;
  /** Going on now (a deploy): in amber, and on the one-line card too. */
  active?: boolean;
}

/** A heading above the board: a Stack and the worktree that deployed to it last. */
export interface BoardHeading {
  /** What it is about, in bold: the Stack's name. */
  label: string;
  /** How it stands: the worktree, or that there is no record. */
  text?: string;
  /** When it happened (ms since the epoch): shown as how long ago. */
  at?: number;
  /** Going on now (a deploy): in amber. */
  active?: boolean;
  /** Shown when the pointer rests on it. */
  detail?: string;
}

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

/** An open pull request of mine, as `gh pr list --json number,title,url,headRefName,isDraft,updatedAt,isCrossRepository` gives it. */
export interface OpenPr {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  isDraft?: boolean;
  /** ISO 8601 */
  updatedAt?: string;
  /** From a fork's branch: it is not the worktree's on the branch of the same name. */
  isCrossRepository?: boolean;
}

/** A closed or merged pull request of mine: the latest of its branch of this repository. */
export interface ClosedPr {
  number: number;
  headRefName: string;
  /** Its last commit: a worktree on the branch is its worktree only on this commit. */
  headRefOid?: string;
  /** MERGED or CLOSED */
  state: string;
  title: string;
  url: string;
}

/** A worktree of a repository, as `fetch` and `headings` get it. */
export interface Worktree {
  /** A real path. */
  path: string;
  /** Its branch; while a rebase stopped there, the branch the rebase puts back. Absent when HEAD is detached otherwise. */
  branch?: string;
  /** HEAD is detached: a rebase stopped there, or a commit is checked out. */
  detached?: true;
  /** A rebase stopped there (HEAD is detached). */
  rebasing?: true;
  /** The commit it is on: a closed pull request is the worktree's only while the worktree is on its last commit. */
  head?: string;
}

/** A repository as `fetch` and `headings` get it: what the kanban has just read of it. */
export interface FetchRepo {
  /** OWNER/REPO, as GitHub names it now: its origin may still say a name from before the repository or its owner was renamed. */
  repo: string;
  primary: Worktree;
  /** Worktrees other than the primary checkout whose folder is there. */
  worktrees: Worktree[];
  /** My open pull requests. */
  prs: OpenPr[];
  /** My latest closed pull request of each branch. */
  closed: ClosedPr[];
}

/** What `fetch` keeps for itself between its calls, for each repository: kept when gasho-daemon starts again. */
export interface FetchStore<K = unknown> {
  /** What `set` kept last for this repository (undefined before the first one). */
  get(): K | undefined;
  /** Keeps `value` (JSON, up to 256 KB) in the kanban's folder of the working server. */
  set(value: K): Promise<void>;
}

/** What a command printed. */
export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface FetchContext<K = unknown> {
  /**
   * gh of the working server, run by gasho-daemon for every plugin (ctx.github.read of Gasho's plugin SDK): give gh's
   * arguments without "gh", and name the repository with --repo (or with `{ repo }` for `gh api graphql`). gasho-daemon
   * answers the same arguments from what gh said within 30 seconds (`maxAgeSeconds`).
   */
  github: {
    read(args: string[], options?: { maxAgeSeconds?: number; repo?: string; timeoutMs?: number; maxBuffer?: number }): Promise<ExecResult>;
  };
  /**
   * Runs a command on the working server (ctx.exec of Gasho's plugin SDK): no shell, no terminal, stopped after 30
   * seconds by default. It throws when the command fails, with `code`, `stdout` and `stderr`. Use `github` for gh.
   */
  exec(command: string, args: string[], options?: { cwd?: string; timeoutMs?: number; maxBuffer?: number; env?: Record<string, string> }): Promise<ExecResult>;
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
