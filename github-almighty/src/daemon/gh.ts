// The gh calls of github-almighty, and what their output becomes. gasho-daemon runs gh for every plugin (ctx.github),
// with the login of whoever runs it, and answers a read from what it kept when the same arguments were read recently.
// Everything here only builds arguments and reads output, so that it can be tested without gh.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import type { GitHubCheck, GitHubComment, GitHubFile, GitHubItemDetail, GitHubKind, GitHubReview, ItemSummary, RepoMeta, WorktreeItems } from "../types.ts";

// ---- what comes from the browser ----

/** owner/name of a GitHub repository; never something gh would take as a flag. */
export function repoArg(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(v) || v.startsWith("-")) {
    throw new PluginError("リポジトリの指定が正しくありません。");
  }
  return v;
}

export function numberArg(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 1e9) throw new PluginError("番号が正しくありません。");
  return n;
}

export function kindArg(v: unknown): GitHubKind {
  if (v !== "issues" && v !== "pulls") throw new PluginError("Issue か Pull request かの指定が正しくありません。");
  return v;
}

/** A branch name as git allows it (roughly), or undefined for none. */
export function branchArg(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || v.length > 250 || v.startsWith("-") || /[\s~^:?*[\\\0]|\.\.|@\{/.test(v)) {
    throw new PluginError("ブランチの指定が正しくありません。");
  }
  return v;
}

/** Text for a title, a body or a comment. */
export function textArg(v: unknown, what: string, max: number): string {
  if (typeof v !== "string") throw new PluginError(`${what}が正しくありません。`);
  if (v.length > max) throw new PluginError(`${what}が長すぎます（${max.toLocaleString()} 文字まで）。`);
  return v;
}

/** GitHub logins (or @me, gh's name for its own login). */
export function loginsArg(v: unknown): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 20 || !v.every((l) => typeof l === "string" && (l === "@me" || /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(l)))) {
    throw new PluginError("担当者の指定が正しくありません。");
  }
  return v as string[];
}

export function labelsArg(v: unknown): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 50 || !v.every((l) => typeof l === "string" && l.trim() !== "" && l.length <= 100 && !/[\n\r,]/.test(l))) {
    throw new PluginError("ラベルの指定が正しくありません。");
  }
  return v as string[];
}

// ---- a worktree's issues and pull requests: one GraphQL query (1 point of the hourly 5000) ----

/** The issue or pull request a branch is named after: feat/17-… and fix/17-… are #17. */
export function branchNumber(branch: string | undefined): number | undefined {
  const m = /^[a-z]+\/(\d+)-/.exec(branch ?? "");
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 1e9 ? n : undefined;
}

const SUMMARY = "__typename ... on Issue { number title state url } ... on PullRequest { number title state isDraft url }";
const PULL_SUMMARY = "__typename number title state isDraft url";

/**
 * The gh arguments that read a worktree's issues and pull requests at once: the pull requests whose head is `branch`
 * and every number asked for. The numbers go into the query itself (aliases n<number>), which only ever holds digits.
 */
export function itemsQueryArgs(repo: string, branch: string | undefined, numbers: number[]): string[] {
  const [owner, name] = repo.split("/") as [string, string];
  const fields = [...new Set(numbers)].map((n) => `n${n}: issueOrPullRequest(number: ${n}) { ${SUMMARY} }`);
  if (branch) fields.unshift(`pulls: pullRequests(headRefName: $branch, first: 10, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { ${PULL_SUMMARY} } }`);
  // A query needs a field: __typename when there is nothing else to read.
  const query = `query($owner: String!, $name: String!${branch ? ", $branch: String!" : ""}) { repository(owner: $owner, name: $name) { ${fields.join(" ") || "__typename"} } }`;
  return ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, ...(branch ? ["-f", `branch=${branch}`] : [])];
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function summary(raw: unknown): ItemSummary | undefined {
  const r = (raw ?? {}) as Record<string, unknown>;
  const number = num(r.number);
  const title = str(r.title);
  const url = str(r.url);
  // Shown as links in browsers: only pages on github.com.
  if (number === undefined || title === undefined || !url?.startsWith("https://github.com/")) return undefined;
  const kind: GitHubKind = r.__typename === "PullRequest" ? "pulls" : "issues";
  const state = str(r.state)?.toUpperCase();
  return {
    kind,
    number,
    title,
    state: state === "MERGED" ? "merged" : state === "CLOSED" ? "closed" : "open",
    ...(kind === "pulls" && r.isDraft === true ? { draft: true } : {}),
    url,
  };
}

/** The output of itemsQueryArgs as a worktree's items. `named` and `added` are the numbers that were asked for. */
export function parseItems(json: string, named: number | undefined, added: number[], at: number): WorktreeItems {
  const data = (JSON.parse(json) as { data?: { repository?: Record<string, unknown> | null } }).data?.repository ?? {};
  const pullNodes = ((data.pulls as { nodes?: unknown[] } | undefined)?.nodes ?? []) as unknown[];
  const pulls = pullNodes.flatMap((n) => summary(n) ?? []);
  const of = (n: number) => summary(data[`n${n}`]);
  const namedItem = named === undefined ? undefined : of(named);
  return {
    ...(namedItem ? { named: namedItem } : {}),
    pulls,
    added: added.flatMap((n) => of(n) ?? []),
    missing: added.filter((n) => !of(n)),
    at,
  };
}

// ---- one issue or pull request ----

const ISSUE_DETAIL_FIELDS = "number,title,url,state,stateReason,author,createdAt,updatedAt,closedAt,labels,assignees,body,comments";
const PULL_DETAIL_FIELDS =
  "number,title,url,state,author,createdAt,updatedAt,closedAt,mergedAt,labels,assignees,body,comments,reviews,isDraft," +
  "headRefName,baseRefName,reviewDecision,additions,deletions,changedFiles,files,commits,statusCheckRollup";
/** Text sent per comment or review, comments per item, and files per pull request. A body is never cut: the edit box starts from it, and saving a cut one would overwrite the rest on GitHub. */
const TEXT_MAX = 60_000;
const COMMENTS_MAX = 200;
const FILES_MAX = 300;

export function detailArgs(repo: string, kind: GitHubKind, number: number): string[] {
  return [kind === "issues" ? "issue" : "pr", "view", String(number), "--repo", repo, "--json", kind === "issues" ? ISSUE_DETAIL_FIELDS : PULL_DETAIL_FIELDS];
}

const login = (v: unknown): string | undefined => str((v as { login?: unknown } | null | undefined)?.login);
/** Links shown in browsers: https only. */
const httpsUrl = (v: unknown): string | undefined => {
  const s = str(v);
  return s?.startsWith("https://") ? s : undefined;
};
const clip = (s: string): string => (s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX)}\n\n…（長いので、ここから先は GitHub で読んでください）` : s);

const REVIEW: Record<string, GitHubItemDetail["review"]> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  REVIEW_REQUIRED: "review_required",
};
const REVIEW_STATE: Record<string, GitHubReview["state"]> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
  PENDING: "pending",
};

/** A check run's or commit status's result, in a few words. */
export function checkState(c: { status?: unknown; conclusion?: unknown; state?: unknown }): GitHubCheck["state"] {
  const state = str(c.state)?.toUpperCase();
  if (state) {
    if (state === "SUCCESS") return "success";
    if (state === "FAILURE" || state === "ERROR") return "failure";
    return "pending";
  }
  if (str(c.status)?.toUpperCase() !== "COMPLETED") return "pending";
  switch (str(c.conclusion)?.toUpperCase()) {
    case "SUCCESS":
      return "success";
    case "SKIPPED":
      return "skipped";
    case "CANCELLED":
      return "cancelled";
    case "NEUTRAL":
    case "STALE":
      return "neutral";
    default:
      return "failure";
  }
}

/** `gh issue view` / `gh pr view --json …` output as an item; undefined when it is not one. */
export function parseDetail(json: string, kind: GitHubKind): GitHubItemDetail | undefined {
  const raw = JSON.parse(json) as Record<string, unknown> | null;
  const number = num(raw?.number);
  const title = str(raw?.title);
  const url = str(raw?.url);
  if (!raw || number === undefined || title === undefined || !url?.startsWith("https://github.com/")) return undefined;
  const state = str(raw.state)?.toUpperCase();
  const reason = str(raw.stateReason)?.toUpperCase();
  const labels = (Array.isArray(raw.labels) ? raw.labels : []).flatMap((l) =>
    typeof l?.name === "string" ? [{ name: l.name as string, ...(typeof l.color === "string" && /^[0-9a-f]{6}$/i.test(l.color) ? { color: l.color as string } : {}) }] : [],
  );
  const comments = (Array.isArray(raw.comments) ? raw.comments : []).flatMap((c): GitHubComment[] => {
    const createdAt = str(c?.createdAt);
    if (!createdAt) return [];
    const minimized = c?.isMinimized === true;
    return [
      {
        ...(login(c?.author) ? { author: login(c?.author) } : {}),
        createdAt,
        body: minimized ? "" : clip(str(c?.body) ?? ""),
        ...(httpsUrl(c?.url) ? { url: httpsUrl(c?.url) } : {}),
        ...(minimized ? { minimized: true } : {}),
      },
    ];
  });
  const item: GitHubItemDetail = {
    kind,
    number,
    title,
    url,
    ...(login(raw.author) ? { author: login(raw.author) } : {}),
    createdAt: str(raw.createdAt) ?? "",
    updatedAt: str(raw.updatedAt) ?? "",
    labels,
    state: state === "MERGED" ? "merged" : state === "CLOSED" ? "closed" : "open",
    ...(state === "CLOSED" && reason === "NOT_PLANNED" ? { stateReason: "not_planned" as const } : {}),
    ...(state === "CLOSED" && reason === "COMPLETED" ? { stateReason: "completed" as const } : {}),
    ...(str(raw.closedAt) ? { closedAt: str(raw.closedAt) } : {}),
    ...(str(raw.mergedAt) ? { mergedAt: str(raw.mergedAt) } : {}),
    assignees: (Array.isArray(raw.assignees) ? raw.assignees : []).flatMap((a) => (login(a) ? [login(a) as string] : [])),
    body: str(raw.body) ?? "",
    comments: comments.slice(-COMMENTS_MAX),
    ...(comments.length > COMMENTS_MAX ? { commentsLeftOut: comments.length - COMMENTS_MAX } : {}),
  };
  if (kind !== "pulls") return item;
  if (raw.isDraft === true) item.draft = true;
  if (str(raw.headRefName)) item.head = str(raw.headRefName);
  if (str(raw.baseRefName)) item.base = str(raw.baseRefName);
  const review = REVIEW[str(raw.reviewDecision) ?? ""];
  if (review) item.review = review;
  // Reviews that only hold comments on lines of the code have no text of their own; those are left out.
  item.reviews = (Array.isArray(raw.reviews) ? raw.reviews : []).flatMap((r): GitHubReview[] => {
    const submittedAt = str(r?.submittedAt);
    const s = REVIEW_STATE[str(r?.state)?.toUpperCase() ?? ""];
    const body = str(r?.body) ?? "";
    if (!submittedAt || !s || (s === "commented" && !body.trim())) return [];
    return [{ ...(login(r?.author) ? { author: login(r?.author) } : {}), submittedAt, state: s, body: clip(body) }];
  });
  const files = (Array.isArray(raw.files) ? raw.files : []).flatMap((f): GitHubFile[] =>
    str(f?.path) ? [{ path: str(f.path) as string, additions: num(f.additions) ?? 0, deletions: num(f.deletions) ?? 0 }] : [],
  );
  item.files = files.slice(0, FILES_MAX);
  for (const key of ["additions", "deletions", "changedFiles"] as const) {
    const n = num(raw[key]);
    if (n !== undefined) item[key] = n;
  }
  if (Array.isArray(raw.commits)) item.commits = raw.commits.length;
  item.checks = (Array.isArray(raw.statusCheckRollup) ? raw.statusCheckRollup : []).flatMap((c): GitHubCheck[] => {
    const name = str(c?.name) ?? str(c?.context);
    if (!name) return [];
    const workflow = str(c?.workflowName);
    const link = httpsUrl(c?.detailsUrl) ?? httpsUrl(c?.targetUrl);
    return [{ name: workflow && workflow !== name ? `${workflow} / ${name}` : name, state: checkState(c ?? {}), ...(link ? { url: link } : {}) }];
  });
  return item;
}

// ---- a repository's labels and assignable people ----

export const labelsArgs = (repo: string): string[] => ["label", "list", "--repo", repo, "--limit", "200", "--json", "name,color"];
export const assignableArgs = (repo: string): string[] => ["api", `repos/${repo}/assignees?per_page=100`];
export const meArgs = ["api", "user"];

export function parseMeta(labelsJson: string, assignableJson: string, meJson: string | undefined): RepoMeta {
  const labels = (JSON.parse(labelsJson) as unknown[]).flatMap((l) => {
    const r = (l ?? {}) as Record<string, unknown>;
    const name = str(r.name);
    const color = str(r.color);
    return name ? [{ name, ...(color && /^[0-9a-f]{6}$/i.test(color) ? { color } : {}) }] : [];
  });
  const assignable = (JSON.parse(assignableJson) as unknown[]).flatMap((u) => (login(u) ? [login(u) as string] : []));
  const me = meJson ? login(JSON.parse(meJson)) : undefined;
  return { labels, assignable, ...(me ? { me } : {}) };
}

// ---- changing GitHub ----
// Values go after "=" (--body=…), so that a text starting with "-" is never taken as a flag.

const cmd = (kind: GitHubKind) => (kind === "issues" ? "issue" : "pr");

export function editArgs(repo: string, kind: GitHubKind, number: number, change: { title?: string; body?: string; addAssignees?: string[]; removeAssignees?: string[]; addLabels?: string[]; removeLabels?: string[] }): string[] {
  const args = [cmd(kind), "edit", String(number), "--repo", repo];
  if (change.title !== undefined) args.push(`--title=${change.title}`);
  if (change.body !== undefined) args.push(`--body=${change.body}`);
  for (const a of change.addAssignees ?? []) args.push(`--add-assignee=${a}`);
  for (const a of change.removeAssignees ?? []) args.push(`--remove-assignee=${a}`);
  for (const l of change.addLabels ?? []) args.push(`--add-label=${l}`);
  for (const l of change.removeLabels ?? []) args.push(`--remove-label=${l}`);
  return args;
}

export const commentArgs = (repo: string, kind: GitHubKind, number: number, body: string): string[] => [cmd(kind), "comment", String(number), "--repo", repo, `--body=${body}`];

/** Close or reopen; an issue closes as done (completed) or as not planned. */
export function stateArgs(repo: string, kind: GitHubKind, number: number, action: "close" | "reopen", reason?: "completed" | "not_planned"): string[] {
  const args = [cmd(kind), action, String(number), "--repo", repo];
  if (action === "close" && kind === "issues" && reason) args.push(`--reason=${reason === "not_planned" ? "not planned" : "completed"}`);
  return args;
}

/** Marks a pull request ready for review, or (undo) turns it back into a draft. */
export const readyArgs = (repo: string, number: number, ready: boolean): string[] => ["pr", "ready", String(number), "--repo", repo, ...(ready ? [] : ["--undo"])];

// ---- errors ----

/** Why a gh call failed, for the person looking at the screen. */
export function ghError(e: unknown): string {
  const err = (e ?? {}) as { code?: unknown; stderr?: unknown; message?: unknown; killed?: unknown; gashoPluginError?: unknown };
  if (err.gashoPluginError === true && typeof err.message === "string") return err.message;
  if (err.code === "ENOENT") {
    return "この working server に GitHub CLI（gh）がありません。gh を入れて、gh auth login でログインしてください。";
  }
  if (err.killed === true) return "GitHub からの応答が遅く、読み込めませんでした。";
  const text = [err.stderr, err.message].filter((t): t is string => typeof t === "string").join("\n");
  if (/gh auth login|not logged in|authentication/i.test(text)) {
    return "この working server の GitHub CLI（gh）がログインしていません。working server で gh auth login を実行してください。";
  }
  if (/Could not resolve to an? (issue|pull ?request)/i.test(text)) return "この番号の Issue や Pull request は見つかりません。";
  if (/Could not resolve to a Repository|HTTP 404|not found/i.test(text)) {
    return "GitHub でこのリポジトリを読めませんでした。gh でログインしているアカウントに権限がないか、リポジトリがありません。";
  }
  const first = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("Command failed"));
  return `GitHub での処理に失敗しました：${(first ?? "原因が分かりません").slice(0, 200)}`;
}
