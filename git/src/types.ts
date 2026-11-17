// What the Git plugin reads with gh and shows: a repository's open issues or pull requests, and one of them with its
// conversation. The daemon part (src/daemon) makes them, the web part (src/web) shows them.
import type { GitHubRepo } from "@gasho/plugin-sdk";

export type { GitHubRepo };

/** Which list of a GitHub repository: its issues or its pull requests. */
export type GitHubListKind = "issues" | "pulls";

/** An open issue or pull request of the GitHub repository a session works in. */
export interface GitHubItem {
  number: number;
  title: string;
  url: string;
  author?: string;
  /** ISO 8601 */
  createdAt: string;
  updatedAt: string;
  labels: { name: string; color?: string }[];
  /** Pull requests: a draft, its branch and the branch it goes into, and the review's state. */
  draft?: boolean;
  head?: string;
  base?: string;
  review?: "approved" | "changes_requested" | "review_required";
}

/** The open issues or pull requests of a repository, newest first, as gasho-daemon read them with `gh`. */
export interface GitHubList {
  repo: GitHubRepo;
  kind: GitHubListKind;
  items: GitHubItem[];
  /** More are open than were sent. */
  truncated: boolean;
  /** Issues are turned off in the repository (as in a fork, by default): there is no list. */
  disabled?: boolean;
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
export interface GitHubItemDetail extends GitHubItem {
  kind: GitHubListKind;
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
  reviews?: GitHubReview[];
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  files?: GitHubFile[];
  commits?: number;
  checks?: GitHubCheck[];
}
