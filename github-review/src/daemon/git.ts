// git for github-review, run with ctx.exec (no shell, no terminal, no prompts), and only in the clones found in the
// folders Gasho can start sessions in: a path from a browser never reaches git. A review worktree is
// review-<repository>-<number> beside the primary checkout (review-<number> before, still taken as one). A pull
// request of the same repository gets a local branch of its name that tracks origin's, so the reviewer can push to
// it; one from a fork is checked out at its head, detached, to read and test.
import fs from "node:fs/promises";
import path from "node:path";
import { PluginError, type DaemonStartContext } from "@gasho/plugin-sdk/daemon";
import type { Created, PrWorktree, Removed, RepoOption } from "../types.ts";

export type Exec = DaemonStartContext["exec"];

/** What went wrong, for the person looking at the page (a PluginError: the page shows its words). */
export class ReviewError extends PluginError {}

// ---- what git gives ----

/** A worktree of `git worktree list --porcelain`. */
export interface WorktreeEntry {
  path: string;
  head?: string;
  /** Absent when HEAD is detached. */
  branch?: string;
  bare?: boolean;
}

/** `git worktree list --porcelain`: the primary checkout first. */
export function parseWorktrees(porcelain: string): WorktreeEntry[] {
  const out: WorktreeEntry[] = [];
  let cur: WorktreeEntry | undefined;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice("worktree ".length) };
      out.push(cur);
    } else if (!cur) continue;
    else if (line.startsWith("HEAD ")) cur.head = line.slice("HEAD ".length);
    else if (line.startsWith("branch refs/heads/")) cur.branch = line.slice("branch refs/heads/".length);
    else if (line === "bare") cur.bare = true;
  }
  return out;
}

/** OWNER/REPO of a GitHub remote (https, optionally with credentials, or ssh). Never returns the raw URL. */
export function parseGitHubUrl(url: string): string | undefined {
  const m = url.trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return m?.[1] && m[2] ? `${m[1]}/${m[2]}` : undefined;
}

/** A clone of a repository on GitHub and its worktrees (the primary checkout first), with real paths. */
export interface Clone {
  path: string;
  github: string;
  worktrees: WorktreeEntry[];
}

/**
 * The repository's name in a review worktree's name: REPO of OWNER/REPO, keeping only what GitHub allows in one
 * (letters, digits, ".", "-", "_"), so the folder name is safe whatever the clone's folder is called.
 */
export const repoName = (github: string): string => (github.split("/").pop() ?? "").replace(/[^A-Za-z0-9._-]/g, "").replace(/^\.+/, "");

/** The folder name of a pull request's review worktree: review-<repository>-<number>. */
export const reviewName = (github: string, number: number): string => {
  const repo = repoName(github);
  return repo ? `review-${repo}-${number}` : `review-${number}`;
};

/** The review worktree a pull request gets now: review-<repository>-<number> in the folder that holds the primary checkout. */
export const reviewPath = (clone: Pick<Clone, "path" | "github">, number: number): string => path.join(path.dirname(clone.path), reviewName(clone.github, number));

/** The review worktree of a pull request made before the name held the repository's: review-<number>. */
export const legacyReviewPath = (primary: string, number: number): string => path.join(path.dirname(primary), `review-${number}`);

/** Where a pull request's review worktree may be: the name it gets now first, then the one from before. */
export const reviewPaths = (clone: Pick<Clone, "path" | "github">, number: number): string[] => [reviewPath(clone, number), legacyReviewPath(clone.path, number)];

/** The pull requests that have a review worktree in a clone, under either name. */
export function reviewNumbers(clone: Clone): number[] {
  const numbers = clone.worktrees.flatMap((w) => {
    const m = /^review-(?:.+-)?(\d{1,9})$/.exec(path.basename(w.path));
    const n = Number(m?.[1]);
    return m && n >= 1 && reviewPaths(clone, n).includes(w.path) ? [n] : [];
  });
  return [...new Set(numbers)];
}

/**
 * The worktree of a pull request in a clone: its review worktree, or else (for one of the same repository) the
 * worktree on its branch, which may be the primary checkout. A fork's branch name says nothing about a local branch.
 */
export function prWorktree(clone: Clone, pr: { number: number; branch: string; fork?: boolean }): PrWorktree | undefined {
  const at = reviewPaths(clone, pr.number).flatMap((p) => clone.worktrees.filter((w) => w.path === p))[0];
  if (at) return { path: at.path, ...(at.branch ? { branch: at.branch } : {}), review: true };
  if (pr.fork) return undefined;
  const on = clone.worktrees.find((w) => w.branch === pr.branch);
  return on && { path: on.path, branch: pr.branch, review: false };
}

// ---- running git ----

/** git with stable English output. Reads take no optional locks (git status would otherwise refresh the index). */
async function git(exec: Exec, cwd: string, args: string[], o: { timeoutMs?: number; write?: boolean } = {}): Promise<string> {
  const env: Record<string, string> = { LC_ALL: "C", ...(o.write ? {} : { GIT_OPTIONAL_LOCKS: "0" }) };
  const { stdout } = await exec("git", ["-C", cwd, ...args], { timeoutMs: o.timeoutMs ?? 15_000, maxBuffer: 8 * 1024 * 1024, env });
  return stdout;
}

const succeeds = (p: Promise<unknown>): Promise<boolean> => p.then(
  () => true,
  () => false,
);

/** git's own words for a failure: its last line that says something. */
function gitWords(e: unknown): string {
  const err = (e ?? {}) as { stderr?: unknown; message?: unknown; killed?: unknown };
  if (err.killed === true) return "git が時間内に終わりませんでした。";
  const text = [err.stderr, err.message].filter((t): t is string => typeof t === "string").join("\n");
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("Command failed") && !l.startsWith("hint:"));
  return (lines.find((l) => /^(fatal|error):/.test(l)) ?? lines[0] ?? "原因が分かりません").slice(0, 300);
}

/** Runs a git step that changes something; a failure says which step and git's words. */
async function step(what: string, run: Promise<unknown>): Promise<void> {
  try {
    await run;
  } catch (e) {
    throw new ReviewError(`${what}できませんでした：${gitWords(e)}`);
  }
}

async function realPath(p: string): Promise<string> {
  return fs.realpath(p).catch(() => path.resolve(p));
}

/**
 * How many git commands repoOptions runs at once. Starting git can take a third of a second, and a working server can
 * have a hundred folders: listed one after another, they took longer than watch (which lists them again) may take.
 */
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
 * The repositories in `folders` (those Gasho can start sessions in), one per repository however many of its worktrees
 * are there, by their primary checkout. Folders that are not in a repository and bare repositories are left out.
 */
export async function repoOptions(exec: Exec, folders: readonly string[]): Promise<RepoOption[]> {
  const commons = await inParallel(folders, PARALLEL_GIT, (dir) =>
    git(exec, dir, ["rev-parse", "--git-common-dir"]).then((s) => path.resolve(dir, s.trim()), () => undefined),
  );
  // One folder of each repository, however many of its worktrees are among the folders.
  const repos = new Map<string, string>();
  folders.forEach((dir, i) => {
    const common = commons[i];
    if (common && !repos.has(common)) repos.set(common, dir);
  });
  const found = await inParallel([...repos.values()], PARALLEL_GIT, async (dir): Promise<RepoOption | undefined> => {
    const primary = await git(exec, dir, ["worktree", "list", "--porcelain"]).then((s) => parseWorktrees(s)[0], () => undefined);
    if (!primary || primary.bare) return undefined;
    const github = await git(exec, primary.path, ["remote", "get-url", "origin"]).then(parseGitHubUrl, () => undefined);
    return { path: await realPath(primary.path), ...(github ? { github } : {}) };
  });
  // Those on GitHub first: the others cannot be watched.
  return found
    .filter((o): o is RepoOption => o !== undefined)
    .sort((a, b) => Number(!a.github) - Number(!b.github) || (a.github ?? a.path).localeCompare(b.github ?? b.path));
}

/** A repository's clone as it is now: its worktrees, with real paths. */
export async function readClone(exec: Exec, option: RepoOption & { github: string }): Promise<Clone> {
  const list = parseWorktrees(await git(exec, option.path, ["worktree", "list", "--porcelain"]));
  return { path: option.path, github: option.github, worktrees: await Promise.all(list.map(async (w) => ({ ...w, path: await realPath(w.path) }))) };
}

/** A pull request's head, as GitHub has it now. */
export interface PrHead {
  number: number;
  branch: string;
  fork: boolean;
  /** The commit at its head. */
  head?: string;
}

/** A branch name from GitHub that git takes as a branch, and never as an option. */
function branchName(b: string): string {
  if (!b || b.length > 250 || b.startsWith("-") || /[\s~^:?*[\\\0]|\.\.|@\{|\/\/|\.lock$|^\/|\/$/.test(b)) {
    throw new ReviewError(`ブランチ名「${b.slice(0, 100)}」を git で扱えません。`);
  }
  return b;
}

/**
 * Makes the review worktree of a pull request in a clone, or finds the worktree it has. One of the same repository is
 * on a local branch of its name, tracking origin's (made now, or one there already that has nothing origin lacks);
 * one from a fork is at its head, detached.
 */
export async function createWorktree(exec: Exec, clone: Clone, pr: PrHead): Promise<Created> {
  const found = prWorktree(clone, pr);
  if (found) return { path: found.path, created: false, ...(found.branch ? { branch: found.branch } : {}) };
  const dest = reviewPath(clone, pr.number);
  if (await succeeds(fs.lstat(dest))) {
    throw new ReviewError(`${dest} がもうあります。この repo の worktree ではないので、使いません。名前を変えるか消してから、もう一度作ってください。`);
  }
  const w = { write: true, timeoutMs: 60_000 };
  if (pr.fork) {
    await step("fork の Pull request を取ってくることが", git(exec, clone.path, ["fetch", "origin", `refs/pull/${pr.number}/head`], w));
    await step("worktree を作ることが", git(exec, clone.path, ["worktree", "add", "--detach", dest, "FETCH_HEAD"], w));
    return { path: await realPath(dest), created: true };
  }
  const branch = branchName(pr.branch);
  const remote = `refs/remotes/origin/${branch}`;
  await step(`origin の ${branch} を取ってくることが`, git(exec, clone.path, ["fetch", "origin", `+refs/heads/${branch}:${remote}`], w));
  const local = await succeeds(git(exec, clone.path, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]));
  if (!local) {
    await step("worktree を作ることが", git(exec, clone.path, ["worktree", "add", "--track", "-b", branch, dest, remote], w));
  } else {
    // A local branch of that name, on no worktree (else it was found above): moved up to origin's, unless it has
    // commits origin lacks, which are someone's work.
    if (!(await succeeds(git(exec, clone.path, ["merge-base", "--is-ancestor", `refs/heads/${branch}`, remote])))) {
      throw new ReviewError(`ローカルのブランチ ${branch} に、origin に無い commit があります。push するか消してから、もう一度作ってください。`);
    }
    await step(`ローカルの ${branch} を origin に合わせることが`, git(exec, clone.path, ["branch", "--force", "--track", branch, remote], w));
    await step("worktree を作ることが", git(exec, clone.path, ["worktree", "add", dest, branch], w));
  }
  return { path: await realPath(dest), created: true, branch };
}

/**
 * Removes the review worktree of a pull request and its local branch: only when nothing in it would be lost, that is,
 * no uncommitted change and no commit that is neither on a branch of a remote nor the pull request's head. `anyName`:
 * the worktree on its branch counts too, whatever its name (a merge asked to clean it up). Never the primary checkout.
 */
export async function removeWorktree(exec: Exec, clone: Clone, pr: PrHead, o: { anyName?: boolean } = {}): Promise<Removed> {
  const wt = prWorktree(clone, pr);
  if (!wt || wt.path === clone.path || !(wt.review || o.anyName)) throw new ReviewError(`Pull request #${pr.number} のレビュー用の worktree（${reviewName(clone.github, pr.number)}）はありません。`);
  const changes = (await git(exec, wt.path, ["status", "--porcelain"])).split("\n").filter(Boolean).length;
  if (changes > 0) throw new ReviewError(`${wt.path} に未コミットの変更が ${changes} 件あるので、片付けません。`);
  // The pull request's head counts as pushed: its branch may be gone from origin once merged. A head pushed after the
  // worktree was made is fetched, or the commits before it would be taken for the reviewer's.
  const oid = pr.head && /^[0-9a-f]{40}$/.test(pr.head) ? pr.head : undefined;
  const have = (o: string) => succeeds(git(exec, wt.path, ["cat-file", "-e", `${o}^{commit}`]));
  const unfetched = oid && !(await have(oid))
    ? await git(exec, wt.path, ["fetch", "origin", `refs/pull/${pr.number}/head`], { write: true, timeoutMs: 30_000 }).then(() => undefined, gitWords)
    : undefined;
  const head = oid && (await have(oid)) ? [oid] : [];
  const ahead = Number((await git(exec, wt.path, ["rev-list", "--count", "HEAD", "--not", "--remotes", ...head])).trim());
  if (ahead > 0 && unfetched) {
    throw new ReviewError(`Pull request #${pr.number} の head を取ってこられなかったので、${wt.path} の ${ahead} 個の commit が push 済みかを確かめられません。片付けません：${unfetched}`);
  }
  if (ahead > 0) throw new ReviewError(`${wt.path} に、push していない commit が ${ahead} 個あるので、片付けません。`);
  await step("worktree を消すことが", git(exec, clone.path, ["worktree", "remove", wt.path], { write: true }));
  if (wt.branch) await step(`worktree は消しましたが、ローカルのブランチ ${wt.branch} を消すことが`, git(exec, clone.path, ["branch", "-D", wt.branch], { write: true }));
  return { path: wt.path, ...(wt.branch ? { branch: wt.branch } : {}) };
}
