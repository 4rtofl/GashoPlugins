// What the kanban's daemon part reads on a working server and sends to the web part: the repositories that can be
// watched, and the worktrees and my pull requests of the watched ones, with what their board plugins fetched. The web
// part turns them into cards with the sessions of the moment (src/cards.ts), so the daemon part never needs the sessions.

/** A repository that can be watched: one in the folders Gasho can start sessions in, by its primary checkout. */
export interface RepoOption {
  /** Its primary checkout. */
  path: string;
  /** OWNER/REPO on GitHub; absent when its origin is not on GitHub (it cannot be watched). */
  github?: string;
}

/** An open pull request of mine, as `gh pr list --json number,title,url,headRefName,isDraft,updatedAt` gives it. */
export interface OpenPr {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  isDraft?: boolean;
  /** ISO 8601 */
  updatedAt?: string;
}

/** A closed or merged pull request of mine: the latest of its branch. */
export interface ClosedPr {
  number: number;
  headRefName: string;
  state: string;
  title: string;
  url: string;
}

/** A watched repository as last read. Paths are real paths, to match the sessions' folders. */
export interface RepoMaterial {
  /** OWNER/REPO */
  repo: string;
  primary: { path: string; branch?: string };
  /** Worktrees other than the primary checkout, on a branch. */
  worktrees: { branch: string; path: string }[];
  /** My open pull requests. */
  prs: OpenPr[];
  /** My latest closed pull request of each branch. */
  closed: ClosedPr[];
  /** The board plugin chosen for it in "見る repo" (a folder of kanban/plugins/). */
  plugin?: string;
  /** What that board plugin's `fetch` gave for it last (JSON); its `state` gets it. */
  fetched?: unknown;
}

/** What the daemon part read for the kanban. A repository that could not be read keeps its material as last read. */
export interface Board {
  /** The primary checkouts watched, as chosen. */
  watched: string[];
  /** The board plugin chosen for each of them that has one, by primary checkout. */
  plugins?: Record<string, string>;
  repos: RepoMaterial[];
  /** `repo` is OWNER/REPO, or the folder's name when it is not known. */
  errors: { path: string; repo: string; error: string }[];
  /** When a repository was last read (ms since the epoch). */
  updatedAt?: number;
  /** Reading the repositories now. */
  checking?: boolean;
  /** The board plugins' `fetch` waits until then (ms since the epoch): few of GitHub's GraphQL points are left. */
  fetchPausedUntil?: number;
}

/** Repositories one working server can watch. */
export const MAX_REPOS = 30;
