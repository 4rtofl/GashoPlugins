// What the GitHub plugin reads with gh and shows: a repository's Actions runs (and one run's jobs and steps), its
// Projects (and one project as a board), and its Packages (and one package's versions). The daemon part (src/daemon)
// makes them, the web part (src/web) shows them. Everything is read only.
import type { GitHubRepo } from "@gasho/plugin-sdk";

export type { GitHubRepo };

/** What gh's login lacks for a read, so that the screen can say how to add it. */
export interface MissingScope {
  scope: "read:project" | "read:packages";
  /** The command that adds it (run on the working server). */
  command: string;
}

// ---- Actions ----

/**
 * Where a run, a job or a step stands, in a few words. "waiting": for a deployment's reviewers, still running.
 * "action_required": finished until someone approves it on GitHub (a first pull request from a fork, say).
 */
export type RunState = "success" | "failure" | "cancelled" | "skipped" | "neutral" | "in_progress" | "queued" | "waiting" | "action_required";

export interface Workflow {
  id: number;
  name: string;
  /** .github/workflows/ci.yml */
  path: string;
  /** Disabled workflows are listed too (their old runs stay). */
  active: boolean;
}

export interface Run {
  id: number;
  /** The workflow's run number (#25). */
  number?: number;
  /** Empty when GitHub could not read the workflow's file. */
  workflow: string;
  workflowId?: number;
  title: string;
  branch?: string;
  event: string;
  state: RunState;
  /** GitHub could not start the run (its startup_failure): a wrong workflow file, among other causes. */
  startupFailure?: boolean;
  attempt?: number;
  /** ISO 8601 */
  createdAt: string;
  startedAt?: string;
  /** When it last changed: for a finished run, when it finished. */
  updatedAt?: string;
  url: string;
}

export interface Runs {
  repo: GitHubRepo;
  workflows: Workflow[];
  runs: Run[];
  /** More runs match than were sent. */
  truncated: boolean;
  /** The branches of the latest runs, as if no branch were chosen. */
  branches: string[];
}

export interface Step {
  number: number;
  name: string;
  state: RunState;
  startedAt?: string;
  completedAt?: string;
}

export interface Job {
  id: number;
  name: string;
  state: RunState;
  startedAt?: string;
  completedAt?: string;
  url?: string;
  steps: Step[];
  /** A failed job: the end of its log (of the step that failed, when that can be told), without timestamps or colors. */
  log?: string[];
  /** Why the log could not be read. */
  logError?: string;
}

export interface RunDetail extends Run {
  jobs: Job[];
  /** The run's latest attempt; `attempt` is the one shown (an earlier one when asked for). */
  attempts?: number;
}

// ---- Projects ----

export interface ProjectRef {
  number: number;
  title: string;
  url: string;
  closed: boolean;
  shortDescription?: string;
  updatedAt?: string;
  items: number;
}

export interface Projects {
  repo: GitHubRepo;
  /** The projects linked to the repository. */
  linked: ProjectRef[];
  /** The other projects of the repository's owner. */
  owner: ProjectRef[];
  ownerLogin: string;
  /** More projects than were read, of the repository's or of its owner's. */
  linkedTruncated?: boolean;
  ownerTruncated?: boolean;
  /** gh's login has no read:project: nothing could be read. */
  missing?: MissingScope;
}

/** A single select or iteration field: what the board can make columns of. */
export interface BoardField {
  id: string;
  name: string;
  iteration?: boolean;
  /** An iteration field's: its iterations, those that ended first (as GitHub's board orders them). */
  options: { id: string; name: string; color?: string; startDate?: string; completed?: boolean }[];
}

export interface BoardItem {
  id: string;
  type: "issue" | "pull" | "draft" | "redacted";
  title: string;
  number?: number;
  url?: string;
  /** owner/name, when it is not the session's repository. */
  repo?: string;
  state?: "open" | "closed" | "merged" | "draft" | "not_planned" | "duplicate";
  assignees: string[];
  /** The option or iteration chosen in each single select or iteration field (field id → option or iteration id). */
  values: Record<string, string>;
}

export interface Board {
  repo: GitHubRepo;
  number: number;
  title: string;
  url: string;
  closed: boolean;
  shortDescription?: string;
  fields: BoardField[];
  /** The field the project's first board view makes its columns of (else "Status", else the first single select). */
  defaultField?: string;
  /** In the project's order; archived ones are left out. */
  items: BoardItem[];
  /** The project holds more items than were read. */
  truncated: boolean;
  missing?: MissingScope;
}

// ---- Packages ----

export type PackageType = "npm" | "maven" | "rubygems" | "docker" | "nuget" | "container";

export interface Package {
  type: PackageType;
  name: string;
  visibility: string;
  /** Absent for a user's packages (GitHub does not say). */
  versions?: number;
  createdAt?: string;
  /** When its newest version was published (the package's own updated_at does not change then). */
  publishedAt?: string;
  url: string;
}

export interface Packages {
  repo: GitHubRepo;
  packages: Package[];
  /** gh's login has no read:packages. */
  missing?: MissingScope;
  /** Kinds that could not be read, and why. */
  errors?: string[];
}

export interface PackageVersion {
  id: number;
  /** The version (npm, maven, …) or the image's digest (container). */
  name: string;
  /** Containers: its tags. */
  tags?: string[];
  createdAt?: string;
  url?: string;
}

export interface PackageDetail {
  repo: GitHubRepo;
  package: Package;
  /** Newest first. */
  versions: PackageVersion[];
  truncated: boolean;
  /** How to install the newest version (none for kinds whose command cannot be made from the name). */
  install?: string;
  missing?: MissingScope;
}
