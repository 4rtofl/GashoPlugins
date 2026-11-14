// What github-almighty reads with gh and shows beside a worktree's sessions: the issue its branch is named after, the
// pull requests of its branch, the ones added to it by hand, and one of them with its conversation. The daemon part
// (src/daemon) makes them, the web part (src/web) shows them and asks the daemon part to change them on GitHub.
import type { GitHubRepo } from "@gasho/plugin-sdk";

export type { GitHubRepo };

/** An issue or a pull request. */
export type GitHubKind = "issues" | "pulls";

/** An issue or pull request, as a worktree's tab names it. */
export interface ItemSummary {
  kind: GitHubKind;
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  /** Pull requests: still a draft. */
  draft?: boolean;
  url: string;
}

/** A worktree's issues and pull requests, as gasho-daemon last read them. */
export interface WorktreeItems {
  /** The one the branch is named after (feat/17-… is #17); absent when the branch has no number or there is none. */
  named?: ItemSummary;
  /** The pull requests whose head is the branch, newest first. */
  pulls: ItemSummary[];
  /** The ones added to the worktree by hand, in the order they were added. */
  added: ItemSummary[];
  /** Numbers added by hand that GitHub does not have (or that this login cannot read). */
  missing: number[];
  /** When gh read them (ms since the epoch). */
  at: number;
}

/** A repository's labels and the people its issues can be assigned to, for the pickers of an item's screen. */
export interface RepoMeta {
  labels: { name: string; color?: string }[];
  assignable: string[];
  /** The login of gh on the working server. */
  me?: string;
}

/** A comment on an issue or pull request. Bodies are GitHub Markdown. */
export interface GitHubComment {
  author?: string;
  /** ISO 8601 */
  createdAt: string;
  body: string;
  url?: string;
  /** Hidden on GitHub (spam, off-topic, …); its body is not sent. */
  minimized?: boolean;
}

/** A review of a pull request. */
export interface GitHubReview {
  author?: string;
  /** ISO 8601 */
  submittedAt: string;
  state: "approved" | "changes_requested" | "commented" | "dismissed" | "pending";
  body: string;
}

/** A check or status of a pull request's latest commit (CI). */
export interface GitHubCheck {
  name: string;
  state: "success" | "failure" | "pending" | "skipped" | "neutral" | "cancelled";
  url?: string;
}

/** A file a pull request changes. */
export interface GitHubFile {
  path: string;
  additions: number;
  deletions: number;
}

/** One issue or pull request with its text and conversation, as gasho-daemon read it with `gh`. */
export interface GitHubItemDetail {
  kind: GitHubKind;
  number: number;
  title: string;
  url: string;
  author?: string;
  /** ISO 8601 */
  createdAt: string;
  updatedAt: string;
  labels: { name: string; color?: string }[];
  state: "open" | "closed" | "merged";
  /** Issues closed: whether as done or as not planned. */
  stateReason?: "completed" | "not_planned";
  closedAt?: string;
  mergedAt?: string;
  assignees: string[];
  body: string;
  /** Oldest first; when there are many, the latest ones (`commentsLeftOut` says how many older ones were left out). */
  comments: GitHubComment[];
  commentsLeftOut?: number;
  /** Pull requests only. */
  draft?: boolean;
  head?: string;
  base?: string;
  review?: "approved" | "changes_requested" | "review_required";
  reviews?: GitHubReview[];
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  files?: GitHubFile[];
  commits?: number;
  checks?: GitHubCheck[];
}
