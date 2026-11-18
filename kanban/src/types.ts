// What the kanban's daemon part reads on a working server and sends to the web part: the repositories that can be
// watched, and the worktrees and my pull requests of the watched ones, with what their board plugins fetched. The web
// part turns them into cards with the sessions of the moment (src/cards.ts), so the daemon part never needs the sessions.
import type { FetchRepo } from "../plugins/types.ts";

export type { ClosedPr, OpenPr } from "../plugins/types.ts";

/** A repository that can be watched: one in the folders Gasho can start sessions in, by its primary checkout. */
export interface RepoOption {
  /** Its primary checkout. */
  path: string;
  /** OWNER/REPO on GitHub; absent when its origin is not on GitHub (it cannot be watched). */
  github?: string;
}

/** The pull request a review worktree (review-<number>, made by github-review) is for, whoever opened it. */
export interface ReviewPr {
  /** The review worktree. */
  path: string;
  number: number;
  title: string;
  url: string;
  state: "open" | "merged" | "closed";
  isDraft?: boolean;
  /** ISO 8601 */
  updatedAt?: string;
}

/** A watched repository as last read. Paths are real paths, to match the sessions' folders. */
export interface RepoMaterial extends FetchRepo {
  /** The review worktrees on a branch, with the pull request each is for. */
  reviews?: ReviewPr[];
  /** The board plugin chosen for it in "見る repo" (a folder of the board plugins' folder). */
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
  /** The version of the board plugins in the working server's folder (PluginSet.version): the web part loads them again when it changes. */
  pluginsVersion?: string;
}

/** Repositories one working server can watch. */
export const MAX_REPOS = 30;
