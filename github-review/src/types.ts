// What github-review's daemon part reads on a working server and sends to the web part: the repositories that can be
// watched, and the pull requests of the review page, each with where it is on that working server (the clone of its
// repository, and its worktree there) and the verdict of its review. The web part puts the answers of every working
// server together.
import type { CleanupKind } from "./cleanup.ts";
import type { ReviewMark } from "./verdict.ts";

/** A repository in the folders Gasho can start sessions in, by its primary checkout. */
export interface RepoOption {
  /** Its primary checkout (a real path). */
  path: string;
  /** OWNER/REPO on GitHub; absent when its origin is not on GitHub (it cannot be watched). */
  github?: string;
}

export type PrState = "open" | "closed" | "merged";
/** The checks of its head commit, as GitHub's list of pull requests shows them. */
export type CheckState = "success" | "failure" | "pending";
/** Its review decision (absent when the repository asks for no review). */
export type ReviewState = "approved" | "changes_requested" | "review_required";

/** A worktree of a pull request on a working server. */
export interface PrWorktree {
  /** Its top folder (a real path). */
  path: string;
  /** The branch checked out; absent when HEAD is detached (a pull request from a fork). */
  branch?: string;
  /** review-<number> beside the primary checkout: one made for the review, which "片付ける" removes. */
  review: boolean;
}

/**
 * "マージしてもらう" or "差し戻す" was asked with "終わったら片付ける": the page removes the review worktree once it is
 * done (cleanup.ts), and the session there is at rest.
 */
export interface Cleanup {
  kind: CleanupKind;
  /** The pull request was merged, or I requested changes on it, after it was asked. */
  done: boolean;
  /** Why it could not be removed (it is not tried again; "片付ける" still removes it). */
  problem?: string;
}

/** Where a pull request is on a working server: the clone of its repository, and its worktree there. */
export interface Place {
  /** The primary checkout of the clone. */
  primary: string;
  worktree?: PrWorktree;
  /** Its review worktree is to be removed once what was asked is done. */
  cleanup?: Cleanup;
}

export interface PrRow {
  /** OWNER/REPO of its base. */
  repo: string;
  number: number;
  title: string;
  url: string;
  state: PrState;
  draft?: boolean;
  author?: string;
  /** ISO 8601 */
  createdAt?: string;
  /** ISO 8601 */
  updatedAt?: string;
  labels: { name: string; color?: string }[];
  checks?: CheckState;
  review?: ReviewState;
  /** Comments and review comments. */
  comments: number;
  /** The branch of its head, in the repository its head is in. */
  branch: string;
  /** Its head is in another repository (a fork). */
  fork?: boolean;
  /** The owner of the repository its head is in, for one from a fork (GitHub shows its head as OWNER:BRANCH). */
  headOwner?: string;
  /** The commit of its head. */
  head?: string;
  /** I opened it: GitHub lets me neither approve it nor request changes. */
  own?: boolean;
  /** GitHub found a conflict with its base. */
  conflict?: boolean;
  /** The maintainers may push to its head in the fork. */
  canModify?: boolean;
  /** The latest verdict I posted on it (the mark of the comment). */
  mark?: ReviewMark;
  /** When I last requested changes on it (ISO 8601). */
  changesRequestedAt?: string;
  /** Absent when this working server has no clone of its repository. */
  place?: Place;
}

/** The pull requests of one repository in the lower part of the page. */
export interface RepoPrs {
  /** OWNER/REPO */
  repo: string;
  /** Watched ("対象リポジトリ"); otherwise it is here for the review worktrees of its pull requests. */
  watched: boolean;
  /**
   * Watched: those GitHub found for the search words, the newest of every watched repository's (at most SEARCH_LIMIT
   * in all, in the order of the words).
   */
  prs: PrRow[];
  /** Watched: how many GitHub found for the search words (0 when the words name other repositories). */
  total: number;
  /**
   * Those here for their review worktree that the search did not find: merged or closed ones, whatever the words, and
   * open ones of a repository that is not watched, when the words find them.
   */
  kept: PrRow[];
}

/** What the page shows of one working server. */
export interface Listing {
  /** The primary checkouts watched, as chosen. */
  watched: string[];
  /** The open pull requests GitHub asks me to review (all of GitHub), narrowed by the search words: the newest ones. */
  requested: PrRow[];
  /** How many GitHub found for the upper part (`requested` holds at most SEARCH_LIMIT of them). */
  requestedTotal: number;
  /** The watched repositories, then those with a review worktree of a pull request the search did not find. */
  repos: RepoPrs[];
  errors: string[];
}

/** What "worktree を作る" did: the worktree of the pull request, made now or found. */
export interface Created {
  path: string;
  /** False: it was there already (the page takes the session used last there, and sends nothing). */
  created: boolean;
  branch?: string;
  /** Why it was made otherwise than README says (detached HEAD, another folder name…). */
  note?: string;
}

/** What "片付ける" removed, or would remove. */
export interface Removed {
  path: string;
  /** The local branch removed with it. */
  branch?: string;
  /** False: not yet (only checked, or files would go that the person has not agreed to lose). */
  removed: boolean;
  /** Files git does not track (untracked and ignored ones, a folder for all in it) that go with the worktree: the first ones. */
  files: string[];
  /** How many there are. */
  fileCount: number;
  /** What the person agrees to with `files` (sent back as `agreed`): they go only while they are the same. */
  token?: string;
}

export interface PrComment {
  author?: string;
  body: string;
  /** ISO 8601 */
  at?: string;
  url: string;
  /** I wrote it. */
  mine: boolean;
}

export type CheckRunState = "success" | "failure" | "pending" | "neutral" | "skipped";

/** A check of its head commit: a check run (GitHub Actions…) or a commit status. */
export interface PrCheck {
  name: string;
  state: CheckRunState;
  url?: string;
  description?: string;
}

/** What the side panel shows of a pull request (the daemon's `detail`). */
export interface PrDetail {
  pr: PrRow;
  body: string;
  /** The latest comments, oldest first. */
  comments: PrComment[];
  /** How many older comments are left out. */
  commentsMore: number;
  checks: PrCheck[];
}

/**
 * Its head as GitHub shows it: OWNER:BRANCH for one from a fork, whose branch name alone (main, often) would read as a
 * branch of the repository.
 */
export const headName = (pr: Pick<PrRow, "branch" | "fork" | "headOwner">): string => (pr.fork && pr.headOwner ? `${pr.headOwner}:${pr.branch}` : pr.branch);

/** Its head can be pushed to: in the same repository, in my own fork, or one the maintainers may change. */
export const canPush = (pr: Pick<PrRow, "fork" | "own" | "canModify">): boolean => !pr.fork || pr.own === true || pr.canModify === true;

/** Repositories one working server can watch. */
export const MAX_REPOS = 30;
/** Search words, at most. */
export const MAX_QUERY = 200;
/** Pull requests each part of the page shows, at most (and reads per search). */
export const SEARCH_LIMIT = 50;
