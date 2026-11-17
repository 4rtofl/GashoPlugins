// What github-review's daemon part reads on a working server and sends to the web part: the repositories that can be
// watched, and the pull requests of the review page, each with where it is on that working server (the clone of its
// repository, and its worktree there). The web part puts the answers of every working server together.

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
  /** Its folder is gone, though git still has it: it does not open, and is made again or removed. */
  missing?: boolean;
}

/** Where a pull request is on a working server: the clone of its repository, and its worktree there. */
export interface Place {
  /** The primary checkout of the clone. */
  primary: string;
  worktree?: PrWorktree;
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
  labels: { name: string; color?: string }[];
  checks?: CheckState;
  review?: ReviewState;
  /** Comments and review comments. */
  comments: number;
  /** The branch of its head, in the repository its head is in. */
  branch: string;
  /** Its head is in another repository (a fork). */
  fork?: boolean;
  /** Absent when this working server has no clone of its repository. */
  place?: Place;
}

/** The pull requests of one repository in the lower part of the page. */
export interface RepoPrs {
  /** OWNER/REPO */
  repo: string;
  /** Watched ("対象リポジトリ"); otherwise it is here for the review worktrees of its pull requests. */
  watched: boolean;
  prs: PrRow[];
}

/** What the page shows of one working server. */
export interface Listing {
  /** The primary checkouts watched, as chosen. */
  watched: string[];
  /** The open pull requests GitHub asks me to review (all of GitHub), narrowed by the search words. */
  requested: PrRow[];
  /** How many more GitHub found than `requested` holds. */
  requestedMore?: number;
  /** The watched repositories' pull requests (narrowed by the search words), then those with a review worktree. */
  repos: RepoPrs[];
  /** How many more GitHub found for the watched repositories than `repos` holds. */
  watchedMore?: number;
  errors: string[];
}

/** What "worktree を作る" did: the worktree of the pull request, made now or found. */
export interface Created {
  path: string;
  /** False: it was there already, and only opens. */
  created: boolean;
  branch?: string;
}

/** What "片付ける" removed. */
export interface Removed {
  path: string;
  /** The local branch removed with it. */
  branch?: string;
}

/** Repositories one working server can watch. */
export const MAX_REPOS = 30;
/** Search words, at most. */
export const MAX_QUERY = 200;
