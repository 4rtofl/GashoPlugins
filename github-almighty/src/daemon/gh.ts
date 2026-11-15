// What the operations of github-almighty share about gh: the checks of what comes from the browser, the one query
// that reads a worktree's issues and pull requests, the read of one of them that the parts of detail/ add fields to,
// and the message for a failure. gasho-daemon runs gh for every plugin (ctx.github), with the login of whoever runs it,
// and answers a read from what it kept when the same arguments were read recently. Everything here only builds
// arguments and reads output, so that it can be tested without gh.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import type { GitHubItemDetail, GitHubKind, ItemSummary, WorktreeItems } from "../types.ts";

// ---- what comes from the browser ----

export const objArg = (params: unknown): Record<string, unknown> => (typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {});

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

/** The worktree's top folder: used only as the key of what is kept for it, never as a path to read. */
export function worktreeArg(v: unknown): string {
  if (typeof v !== "string" || !v.startsWith("/") || v.length > 1000) throw new PluginError("worktree の指定が正しくありません。");
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

// ---- reading gh's output ----

export const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
export const login = (v: unknown): string | undefined => str((v as { login?: unknown } | null | undefined)?.login);
/** Links shown in browsers: https only. */
export const httpsUrl = (v: unknown): string | undefined => {
  const s = str(v);
  return s?.startsWith("https://") ? s : undefined;
};
/** A label's color as GitHub gives it (6 hex digits), or undefined. */
export const labelColor = (v: unknown): string | undefined => {
  const s = str(v);
  return s && /^[0-9a-f]{6}$/i.test(s) ? s : undefined;
};

/** Text sent per comment or review. A body is never cut: the edit box starts from it, and saving a cut one would overwrite the rest on GitHub. */
const TEXT_MAX = 60_000;
export const clip = (s: string): string => (s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX)}\n\n…（長いので、ここから先は GitHub で読んでください）` : s);

/** gh's command for an issue or a pull request. */
export const cmd = (kind: GitHubKind): "issue" | "pr" => (kind === "issues" ? "issue" : "pr");

// ---- a worktree's issues and pull requests: one GraphQL query (1 point of the hourly 5000) ----

/** The issue or pull request a branch is named after: feat/17-… and fix/17-… are #17. */
export function branchNumber(branch: string | undefined): number | undefined {
  const m = /^[a-z]+\/(\d+)-/.exec(branch ?? "");
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 1e9 ? n : undefined;
}

export const SUMMARY = "__typename ... on Issue { number title state url } ... on PullRequest { number title state isDraft url }";
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

export function summary(raw: unknown): ItemSummary | undefined {
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

// ---- one issue or pull request: `gh issue view` / `gh pr view --json …` ----

/**
 * A part of the read of one issue or pull request: a file in detail/. It asks gh for more fields and puts what they
 * hold into the item; the fields it adds to GitHubItemDetail are declared there too (declare module "../../types.ts").
 */
export interface DetailPart {
  /** The fields of `--json` it reads, per kind; a part without fields for a kind does not run for it. */
  fields: Partial<Record<GitHubKind, string[]>>;
  read(raw: Record<string, unknown>, item: GitHubItemDetail): void;
}

const CORE_FIELDS: Record<GitHubKind, string[]> = {
  issues: ["number", "title", "url", "state", "stateReason", "author", "createdAt", "updatedAt", "closedAt", "labels", "assignees", "body"],
  pulls: ["number", "title", "url", "state", "author", "createdAt", "updatedAt", "closedAt", "mergedAt", "labels", "assignees", "body", "isDraft", "headRefName", "baseRefName", "reviewDecision", "additions", "deletions", "changedFiles"],
};

export function detailArgs(repo: string, kind: GitHubKind, number: number, parts: DetailPart[]): string[] {
  const fields = new Set([...CORE_FIELDS[kind], ...parts.flatMap((p) => p.fields[kind] ?? [])]);
  return [cmd(kind), "view", String(number), "--repo", repo, "--json", [...fields].join(",")];
}

const REVIEW: Record<string, GitHubItemDetail["review"]> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  REVIEW_REQUIRED: "review_required",
};

/** The output of detailArgs as an item; undefined when it is not one. */
export function parseDetail(json: string, kind: GitHubKind, parts: DetailPart[]): GitHubItemDetail | undefined {
  const raw = JSON.parse(json) as Record<string, unknown> | null;
  const number = num(raw?.number);
  const title = str(raw?.title);
  const url = str(raw?.url);
  if (!raw || number === undefined || title === undefined || !url?.startsWith("https://github.com/")) return undefined;
  const state = str(raw.state)?.toUpperCase();
  const reason = str(raw.stateReason)?.toUpperCase();
  const labels = (Array.isArray(raw.labels) ? raw.labels : []).flatMap((l) => {
    const name = str(l?.name);
    const color = labelColor(l?.color);
    return name ? [{ name, ...(color ? { color } : {}) }] : [];
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
  };
  if (kind === "pulls") {
    if (raw.isDraft === true) item.draft = true;
    if (str(raw.headRefName)) item.head = str(raw.headRefName);
    if (str(raw.baseRefName)) item.base = str(raw.baseRefName);
    const review = REVIEW[str(raw.reviewDecision) ?? ""];
    if (review) item.review = review;
    for (const key of ["additions", "deletions", "changedFiles"] as const) {
      const n = num(raw[key]);
      if (n !== undefined) item[key] = n;
    }
  }
  for (const part of parts) if (part.fields[kind]) part.read(raw, item);
  return item;
}

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
