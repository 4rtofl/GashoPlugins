// Reading a repository for the kanban (moved here from Gasho's apps/daemon/src/kanban.ts of PR #8): its worktrees with
// git (ctx.exec: no shell, no terminal, no prompts), and my open and closed pull requests with the GitHub CLI (gh) of
// the working server, which gasho-daemon runs for every plugin (ctx.github), logged in as whoever runs it. Only reads.
import fs from "node:fs/promises";
import path from "node:path";
import type { DaemonStartContext } from "@gasho/plugin-sdk/daemon";
import type { Worktree } from "../../plugins/types.ts";
import type { ClosedPr, OpenPr, RepoMaterial, RepoOption, ReviewPr } from "../types.ts";

export type Exec = DaemonStartContext["exec"];
export type GitHubRead = DaemonStartContext["github"]["read"];

const PR_LIMIT = 100;
const PR_FIELDS = "number,title,url,headRefName,isDraft,updatedAt,isCrossRepository";
const CLOSED_FIELDS = "number,headRefName,headRefOid,isCrossRepository,state,title,url";

/** What went wrong with a repository, for the person looking at the board. */
export class KanbanError extends Error {}

// ---- what git and gh give ----

/** A worktree as `git worktree list --porcelain` gives it. */
export interface ListedWorktree {
  path: string;
  /** Absent when HEAD is detached. */
  branch?: string;
  /** The commit it is on. */
  head?: string;
  detached?: true;
  bare?: true;
  /** Its folder is gone: git keeps it until `git worktree prune`. */
  prunable?: true;
}

/**
 * `git worktree list --porcelain`: the primary checkout first, then the other worktrees whose folder is there, detached
 * ones too (those whose folder is gone are left out), each with the commit it is on.
 */
export function parseWorktrees(porcelain: string): { primary?: ListedWorktree; worktrees: ListedWorktree[] } {
  const all: ListedWorktree[] = [];
  for (const line of porcelain.split("\n")) {
    const last = all.at(-1);
    if (line.startsWith("worktree ")) all.push({ path: line.slice("worktree ".length) });
    else if (!last) continue;
    else if (line === "bare") last.bare = true;
    else if (line === "detached") last.detached = true;
    else if (line.startsWith("HEAD ")) last.head = line.slice("HEAD ".length);
    else if (line.startsWith("branch refs/heads/")) last.branch = line.slice("branch refs/heads/".length);
    else if (line === "prunable" || line.startsWith("prunable ")) last.prunable = true;
  }
  const [primary, ...worktrees] = all;
  return { primary, worktrees: worktrees.filter((w) => !w.prunable) };
}

/**
 * The branch a rebase that stopped in the worktree `dir` puts back. Its HEAD stays detached until the rebase ends, and
 * `git worktree list` does not say the branch.
 */
async function rebasing(exec: Exec, dir: string): Promise<string | undefined> {
  const gitDir = await git(exec, dir, ["rev-parse", "--absolute-git-dir"]).then((s) => s.trim(), () => undefined);
  if (!gitDir) return undefined;
  for (const kind of ["rebase-merge", "rebase-apply"]) {
    const head = await fs.readFile(path.join(gitDir, kind, "head-name"), "utf8").catch(() => undefined);
    const branch = /^refs\/heads\/(\S+)$/.exec(head?.trim() ?? "")?.[1];
    if (branch) return branch;
  }
  return undefined;
}

/**
 * gh's arguments that read the name GitHub has now for `repo`, as a clone's origin says it. GitHub's search, which `gh
 * pr list --author` reads, finds nothing by a name from before the repository or its owner was renamed (4rtoflow →
 * 4rtofl); `repository(owner:, name:)` still answers to it.
 */
export function nameArgs(repo: string): string[] {
  const [owner = "", name = ""] = repo.split("/");
  return ["api", "graphql", "-f", "query=query($o: String!, $n: String!) { repository(owner: $o, name: $n) { nameWithOwner } }", "-f", `o=${owner}`, "-f", `n=${name}`];
}

/** The name in the answer to nameArgs; undefined when GitHub did not find the repository. */
export function parseName(json: string): string | undefined {
  const name = (JSON.parse(json) as { data?: { repository?: { nameWithOwner?: unknown } | null } | null } | null)?.data?.repository?.nameWithOwner;
  return typeof name === "string" && /^[^/\s]+\/[^/\s]+$/.test(name) ? name : undefined;
}

/** OWNER/REPO of a GitHub remote (https, optionally with credentials, or ssh). Never returns the raw URL. */
export function parseGitHubUrl(url: string): string | undefined {
  const m = url.trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return m?.[1] && m[2] ? `${m[1]}/${m[2]}` : undefined;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
/** Links shown in browsers: pages on github.com only. */
const githubUrl = (v: unknown): v is string => typeof v === "string" && v.startsWith("https://github.com/");

export function parsePrs(data: unknown): OpenPr[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((p): OpenPr[] => {
    if (!isRecord(p) || typeof p.number !== "number" || typeof p.title !== "string" || typeof p.headRefName !== "string" || !githubUrl(p.url)) return [];
    return [
      {
        number: p.number,
        title: p.title,
        url: p.url,
        headRefName: p.headRefName,
        ...(p.isDraft === true ? { isDraft: true } : {}),
        ...(typeof p.updatedAt === "string" ? { updatedAt: p.updatedAt } : {}),
        ...(p.isCrossRepository === true ? { isCrossRepository: true } : {}),
      },
    ];
  });
}

/** Of each branch of the repository, the newest closed pull request (a fork's branch is not one of them). */
export function parseClosed(data: unknown): ClosedPr[] {
  const rows = (Array.isArray(data) ? data : []).flatMap((p): ClosedPr[] =>
    isRecord(p) && typeof p.number === "number" && typeof p.headRefName === "string" && typeof p.state === "string" && githubUrl(p.url) && p.isCrossRepository !== true
      ? [
          {
            number: p.number,
            headRefName: p.headRefName,
            ...(typeof p.headRefOid === "string" ? { headRefOid: p.headRefOid } : {}),
            state: p.state,
            title: typeof p.title === "string" ? p.title : "",
            url: p.url,
          },
        ]
      : [],
  );
  const newest = new Map(rows.sort((a, b) => a.number - b.number).map((r) => [r.headRefName, r]));
  return [...newest.values()];
}

/** Why a `gh` call failed, for the person looking at the board. */
export function ghError(e: unknown): string {
  const err = (e ?? {}) as { code?: unknown; stderr?: unknown; message?: unknown; killed?: unknown };
  if (err.code === "ENOENT") {
    return "この working server に GitHub CLI（gh）がありません。gh を入れて、gh auth login でログインしてください。";
  }
  if (err.killed === true) return "GitHub からの応答が遅く、読み込めませんでした。";
  const text = [err.stderr, err.message].filter((t): t is string => typeof t === "string").join("\n");
  if (/gh auth login|not logged in|authentication/i.test(text)) {
    return "この working server の GitHub CLI（gh）がログインしていません。working server で gh auth login を実行してください。";
  }
  if (/Could not resolve to a Repository|HTTP 404|not found/i.test(text)) {
    return "GitHub でこのリポジトリを読めませんでした。gh でログインしているアカウントに権限がないか、リポジトリがありません。";
  }
  const first = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("Command failed"));
  return `GitHub から読み込めませんでした：${(first ?? "原因が分かりません").slice(0, 200)}`;
}

// ---- running git and gh ----

/** Read-only git: no optional locks (git status would otherwise refresh the index), stable English output. */
async function git(exec: Exec, cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-C", cwd, ...args], { timeoutMs: 15_000, maxBuffer: 8 * 1024 * 1024, env: { GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" } });
  return stdout;
}

async function ghJson(github: GitHubRead, args: string[]): Promise<unknown> {
  const { stdout } = await github(args, { timeoutMs: 30_000, maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(stdout) as unknown;
}

async function realPath(p: string): Promise<string> {
  return fs.realpath(p).catch(() => p);
}

/** How many folders repoOptions reads at once (with git where their files do not tell): a working server can have a hundred. */
const PARALLEL_GIT = 8;

/** `fn` of each of `items`, `n` at a time, in the order of `items`. */
async function inParallel<T, R>(items: readonly T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i] as T);
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/**
 * The common git folder of the repository that holds the folder `dir`, read from what git keeps there (the .git folder,
 * or the .git file's "gitdir:" and that folder's commondir), without running git: null when `dir` is in no repository
 * (there is no .git up to /), undefined when the files do not tell (git tells then).
 */
export async function gitCommonDir(dir: string): Promise<string | null | undefined> {
  if (!(await fs.stat(dir).then((s) => s.isDirectory(), () => false))) return undefined;
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    const dotGit = path.join(d, ".git");
    const stat = await fs.stat(dotGit).catch(() => undefined);
    if (stat?.isDirectory()) return dotGit;
    if (stat?.isFile()) {
      const gitdir = /^gitdir: (.+)$/m.exec(await fs.readFile(dotGit, "utf8").catch(() => ""))?.[1]?.trim();
      if (!gitdir) return undefined;
      const at = path.resolve(d, gitdir);
      return fs.readFile(path.join(at, "commondir"), "utf8").then((c) => path.resolve(at, c.trim()), () => at);
    }
    if (path.dirname(d) === d) return null;
  }
}

/**
 * The values of a git config file, by section[.subsection].key (the section and the key in lower case), the last of
 * each: undefined for one that includes others or has what this does not read (quotes, escapes, comments after a
 * value), which git reads then.
 */
export function parseGitConfig(text: string): Map<string, string> | undefined {
  const values = new Map<string, string>();
  let section = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const head = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"([^"\\]*)")?\s*\]$/.exec(line);
    if (head?.[1]) {
      const name = head[1].toLowerCase();
      if (name === "include" || name === "includeif") return undefined;
      section = head[2] === undefined ? name : `${name}.${head[2]}`;
      continue;
    }
    const kv = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*([^"\\#;]*))?$/.exec(line);
    if (!kv?.[1]) return undefined;
    values.set(`${section}.${kv[1].toLowerCase()}`, (kv[2] ?? "true").trim());
  }
  return values;
}

/**
 * The primary checkout and origin of the repository whose common git folder is `common`, as its files say: the
 * primary checkout holds a .git folder that is not bare and keeps its work tree there, and origin's URL is in its
 * config. What they do not tell is left out.
 */
async function fromFiles(common: string): Promise<{ primary?: string; github?: string; noOrigin?: true }> {
  const text = await fs.readFile(path.join(common, "config"), "utf8").catch(() => undefined);
  const config = text === undefined ? undefined : parseGitConfig(text);
  if (!config) return {};
  const primary = path.basename(common) === ".git" && config.get("core.bare") !== "true" && !config.has("core.worktree") ? await realPath(path.dirname(common)) : undefined;
  const url = config.get("remote.origin.url");
  const github = url === undefined ? undefined : parseGitHubUrl(url);
  return { ...(primary ? { primary } : {}), ...(github ? { github } : {}), ...(url === undefined ? { noOrigin: true as const } : {}) };
}

/**
 * The repositories in `folders` (those Gasho can start sessions in), one per repository however many of its worktrees
 * are there, by their primary checkout. Folders that are not in a repository and bare repositories are left out. Only
 * these can be watched: git runs in a repository's folder, so never in one a browser made up. With a hundred folders
 * git takes long to run for each, so the files of .git tell what they can (most often all), and git the rest.
 */
export async function repoOptions(exec: Exec, folders: readonly string[]): Promise<RepoOption[]> {
  const commons = await inParallel(folders, PARALLEL_GIT, async (dir) => {
    const common = await gitCommonDir(dir);
    if (common !== undefined) return common ?? undefined;
    return git(exec, dir, ["rev-parse", "--git-common-dir"]).then((s) => path.resolve(dir, s.trim()), () => undefined);
  });
  const repos = new Map<string, string>();
  folders.forEach((dir, i) => {
    const common = commons[i];
    if (common && !repos.has(common)) repos.set(common, dir);
  });
  const found = await inParallel([...repos], PARALLEL_GIT, async ([common, dir]): Promise<RepoOption | undefined> => {
    const files = await fromFiles(common);
    const primary =
      files.primary ?? (await git(exec, dir, ["worktree", "list", "--porcelain"]).then((s) => parseWorktrees(s).primary, () => undefined).then((p) => (p && !p.bare ? p.path : undefined)));
    if (!primary) return undefined;
    // An origin URL the config does not give as GitHub's may still be (insteadOf).
    const github = files.github ?? (files.noOrigin ? undefined : await git(exec, primary, ["remote", "get-url", "origin"]).then(parseGitHubUrl, () => undefined));
    return { path: primary, ...(github ? { github } : {}) };
  });
  // One per primary checkout: a folder reached through a symbolic link names its .git folder by another path.
  const byPath = new Map(found.flatMap((o) => (o ? [[o.path, o] as const] : [])));
  // Those on GitHub first: the others cannot be watched.
  return [...byPath.values()].sort((a, b) => Number(!a.github) - Number(!b.github) || (a.github ?? a.path).localeCompare(b.github ?? b.path));
}

/** The review worktrees github-review makes: review-<number> in the folder that holds the primary checkout. */
export function reviewWorktrees(primary: string, worktrees: readonly { path: string }[]): { number: number; path: string }[] {
  return worktrees.flatMap((w) => {
    const n = Number(/^review-(\d{1,9})$/.exec(path.basename(w.path))?.[1]);
    return n >= 1 && w.path === path.join(path.dirname(primary), `review-${n}`) ? [{ number: n, path: w.path }] : [];
  });
}

const REVIEW_STATES: Record<string, ReviewPr["state"]> = { OPEN: "open", MERGED: "merged", CLOSED: "closed" };

/** What one GraphQL query (`reviewQuery`) gave for the review worktrees: the pull request of each, when GitHub has it. */
export function parseReviews(data: unknown, reviews: readonly { number: number; path: string }[]): ReviewPr[] {
  const repository = isRecord(data) && isRecord(data.data) && isRecord(data.data.repository) ? data.data.repository : {};
  return reviews.flatMap((r): ReviewPr[] => {
    const p = repository[`pr${r.number}`];
    if (!isRecord(p) || p.number !== r.number || typeof p.title !== "string" || !githubUrl(p.url) || typeof p.state !== "string") return [];
    const state = REVIEW_STATES[p.state];
    if (!state) return [];
    return [
      {
        path: r.path,
        number: r.number,
        title: p.title,
        url: p.url,
        state,
        ...(p.isDraft === true ? { isDraft: true } : {}),
        ...(typeof p.updatedAt === "string" ? { updatedAt: p.updatedAt } : {}),
      },
    ];
  });
}

/** gh's arguments for the pull requests `numbers` of OWNER/REPO `repo`, whoever opened them: about 1 of GitHub's GraphQL points. */
export function reviewQuery(repo: string, numbers: readonly number[]): string[] {
  const [owner = "", name = ""] = repo.split("/");
  const fields = numbers.map((n) => `pr${n}: pullRequest(number: ${n}) { number title url state isDraft updatedAt }`).join(" ");
  return ["api", "graphql", "-f", `query=query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`, "-f", `owner=${owner}`, "-f", `name=${name}`];
}

/** The pull requests of the review worktrees; GitHub answers with the others when one of them is not there. */
async function readReviews(github: GitHubRead, repo: string, reviews: readonly { number: number; path: string }[]): Promise<ReviewPr[]> {
  if (reviews.length === 0) return [];
  const json = await github(reviewQuery(repo, reviews.map((r) => r.number)), { repo, timeoutMs: 30_000 }).then(
    (r) => r.stdout,
    (e: unknown) => {
      const printed = (e as { stdout?: unknown } | null)?.stdout;
      if (typeof printed === "string" && printed.trim().startsWith("{")) return printed;
      throw e;
    },
  );
  return parseReviews(JSON.parse(json) as unknown, reviews);
}

/** Reads one watched repository: its worktrees, my open and closed pull requests, and those of its review worktrees. */
export async function readRepo(exec: Exec, gh: GitHubRead, option: RepoOption): Promise<RepoMaterial> {
  const repo = option.github;
  if (!repo) throw new KanbanError("origin が GitHub の repo ではないので、見られません。");
  const porcelain = await git(exec, option.path, ["worktree", "list", "--porcelain"]).catch((e: unknown) => {
    throw new KanbanError(`Git の情報を読めませんでした：${String(e instanceof Error ? e.message : e).split("\n")[0]}`);
  });
  const { primary, worktrees } = parseWorktrees(porcelain);
  if (!primary) throw new KanbanError("worktree の一覧を読めませんでした。");
  const list = (state: string, fields: string) =>
    ghJson(gh, ["pr", "list", "--repo", repo, "--author", "@me", "--state", state, "--limit", String(PR_LIMIT), "--json", fields]);
  const [open, closed, reviews] = await Promise.all([list("open", PR_FIELDS), list("closed", CLOSED_FIELDS), readReviews(gh, repo, reviewWorktrees(primary.path, worktrees))]).catch(
    (e: unknown) => {
      throw new KanbanError(ghError(e));
    },
  );
  // A worktree whose rebase stopped keeps its branch, and so its pull request.
  const tree = async (w: ListedWorktree): Promise<Worktree> => {
    const rebased = w.detached ? await rebasing(exec, w.path) : undefined;
    const branch = w.branch ?? rebased;
    return {
      path: await realPath(w.path),
      ...(branch ? { branch } : {}),
      ...(w.head ? { head: w.head } : {}),
      ...(w.detached ? { detached: true } : {}),
      ...(rebased ? { rebasing: true } : {}),
    };
  };
  return {
    repo,
    primary: await tree(primary),
    worktrees: await Promise.all(worktrees.map(tree)),
    prs: parsePrs(open),
    closed: parseClosed(closed),
    ...(reviews.length > 0 ? { reviews: await Promise.all(reviews.map(async (r) => ({ ...r, path: await realPath(r.path) }))) } : {}),
  };
}
