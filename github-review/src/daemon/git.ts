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
  /** git still has it, but its folder is gone. */
  prunable?: boolean;
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
    else if (line === "prunable" || line.startsWith("prunable ")) cur.prunable = true;
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
 * The worktree of a pull request in a clone: its review worktree (even one whose folder is gone, to be made again or
 * removed), or else (for one of the same repository) the worktree on its branch, which may be the primary checkout. A
 * fork's branch name says nothing about a local branch.
 */
export function prWorktree(clone: Clone, pr: { number: number; branch: string; fork?: boolean }): PrWorktree | undefined {
  const at = reviewPaths(clone, pr.number).flatMap((p) => clone.worktrees.filter((w) => w.path === p))[0];
  if (at) return { path: at.path, ...(at.branch ? { branch: at.branch } : {}), review: true, ...(at.prunable ? { missing: true } : {}) };
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
 * The repositories in `folders` (those Gasho can start sessions in), one per repository however many of its worktrees
 * are there, by their primary checkout. Folders that are not in a repository and bare repositories are left out.
 */
export async function repoOptions(exec: Exec, folders: readonly string[]): Promise<RepoOption[]> {
  const found = new Map<string, RepoOption>();
  for (const dir of folders) {
    const common = await git(exec, dir, ["rev-parse", "--git-common-dir"]).then((s) => path.resolve(dir, s.trim()), () => undefined);
    if (!common || found.has(common)) continue;
    const primary = await git(exec, dir, ["worktree", "list", "--porcelain"]).then((s) => parseWorktrees(s)[0], () => undefined);
    if (!primary || primary.bare) continue;
    const github = await git(exec, primary.path, ["remote", "get-url", "origin"]).then(parseGitHubUrl, () => undefined);
    found.set(common, { path: await realPath(primary.path), ...(github ? { github } : {}) });
  }
  // Those on GitHub first: the others cannot be watched.
  return [...found.values()].sort((a, b) => Number(!a.github) - Number(!b.github) || (a.github ?? a.path).localeCompare(b.github ?? b.path));
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

/** Whether GitHub has a commit, in the pull request's repository; it rejects with why when GitHub cannot be read. */
export type OnGitHub = (oid: string) => Promise<boolean>;

/** A commit id as git and GitHub write it (SHA-1, or SHA-256), and never an option. */
const commitId = (s: string | undefined): string | undefined => (s && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(s) ? s : undefined);

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
 * one from a fork is at its head, detached. A review worktree whose folder is gone is removed first, as "片付ける"
 * removes it, and made again.
 */
export async function createWorktree(exec: Exec, clone: Clone, pr: PrHead, o: { onGitHub?: OnGitHub } = {}): Promise<Created> {
  const found = prWorktree(clone, pr);
  if (found && !found.missing) return { path: found.path, created: false, ...(found.branch ? { branch: found.branch } : {}) };
  // Only once what it is made at has been fetched: a merged pull request whose branch went from origin would otherwise
  // lose its local branch, and still get no worktree.
  const removeGone = async () => {
    if (!found) return;
    try {
      await removeWorktree(exec, clone, pr, o);
    } catch (e) {
      throw e instanceof ReviewError ? new ReviewError(`${found.path} のフォルダーは消えていますが、git に残っているものを片付けられないので、作り直しません。${e.message}`) : e;
    }
  };
  const dest = reviewPath(clone, pr.number);
  if (await succeeds(fs.lstat(dest))) {
    throw new ReviewError(`${dest} がもうあります。この repo の worktree ではないので、使いません。名前を変えるか消してから、もう一度作ってください。`);
  }
  const w = { write: true, timeoutMs: 60_000 };
  if (pr.fork) {
    // At the commit GitHub says is its head, not FETCH_HEAD: any other fetch in the clone meanwhile (another pull
    // request's worktree being made, an editor's) writes FETCH_HEAD too.
    const head = commitId(pr.head);
    if (!head) throw new ReviewError(`Pull request #${pr.number} の head の commit が分からないので、worktree を作りません。`);
    await step("fork の Pull request を取ってくることが", git(exec, clone.path, ["fetch", "origin", `refs/pull/${pr.number}/head`], w));
    if (!(await succeeds(git(exec, clone.path, ["cat-file", "-e", `${head}^{commit}`])))) {
      throw new ReviewError(`Pull request #${pr.number} の head が、GitHub から読んだあとに変わりました。もう一度作ってください。`);
    }
    await removeGone();
    await step("worktree を作ることが", git(exec, clone.path, ["worktree", "add", "--detach", dest, head], w));
    return { path: await realPath(dest), created: true };
  }
  const branch = branchName(pr.branch);
  const remote = `refs/remotes/origin/${branch}`;
  await step(`origin の ${branch} を取ってくることが`, git(exec, clone.path, ["fetch", "origin", `+refs/heads/${branch}:${remote}`], w));
  await removeGone();
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
 * The commit a worktree was made at, which was then the pull request's head: the first entry of the reflog of its HEAD
 * (`ref`, read in `cwd`), which `git worktree add` writes without a message. None once git has let that entry expire,
 * as the first one left may be a commit made in the worktree; nor when the newest entry is not `tip` (when given).
 */
async function madeAt(exec: Exec, cwd: string, ref: string, tip?: string): Promise<string | undefined> {
  const entries = await git(exec, cwd, ["log", "--walk-reflogs", "--format=%H %gs", ref, "--"]).then(
    (s) => s.split("\n").map((l) => l.trimEnd()).filter(Boolean),
    () => [],
  );
  if (tip && entries[0]?.split(" ")[0] !== tip) return undefined;
  return commitId(/^[0-9a-f]+$/.test(entries.at(-1) ?? "") ? entries.at(-1) : undefined);
}

/**
 * Removes the review worktree of a pull request and its local branch: only when nothing in it would be lost, that is,
 * no uncommitted change and no commit that is neither on a branch of a remote, nor the pull request's head, nor the
 * commit the worktree was made at (its author may have rebased or force-pushed since) when GitHub has it (`onGitHub`;
 * without it, that commit does not count). One whose folder is gone has
 * no uncommitted change to lose, and git forgets it. `anyName`: the worktree on its branch counts too, whatever its
 * name (a merge asked to clean it up). Never the primary checkout.
 */
export async function removeWorktree(exec: Exec, clone: Clone, pr: PrHead, o: { anyName?: boolean; onGitHub?: OnGitHub } = {}): Promise<Removed> {
  const wt = prWorktree(clone, pr);
  if (!wt || wt.path === clone.path || !(wt.review || o.anyName)) throw new ReviewError(`Pull request #${pr.number} のレビュー用の worktree（${reviewName(clone.github, pr.number)}）はありません。`);
  // One whose folder is gone is read in the primary checkout, which has its HEAD as worktrees/<id>/HEAD; git names a
  // worktree after its folder when it makes it.
  const at = wt.missing
    ? { cwd: clone.path, tip: commitId(clone.worktrees.find((w) => w.path === wt.path)?.head), reflog: `worktrees/${path.basename(wt.path)}/HEAD` }
    : { cwd: wt.path, tip: "HEAD", reflog: "HEAD" };
  const tip = at.tip;
  if (!tip) throw new ReviewError(`${wt.path} の HEAD が読めないので、片付けません。`);
  if (!wt.missing) {
    const changes = (await git(exec, wt.path, ["status", "--porcelain"])).split("\n").filter(Boolean).length;
    if (changes > 0) throw new ReviewError(`${wt.path} に未コミットの変更が ${changes} 件あるので、片付けません。`);
  }
  // The pull request's head counts as pushed: its branch may be gone from origin once merged. One not here is fetched
  // first: the worktree may be on a later head than the one it was made at, whose commits would be taken for the
  // reviewer's.
  const oid = commitId(pr.head);
  const have = (o: string) => succeeds(git(exec, at.cwd, ["cat-file", "-e", `${o}^{commit}`]));
  const unfetched = oid && !(await have(oid))
    ? await git(exec, at.cwd, ["fetch", "origin", `refs/pull/${pr.number}/head`], { write: true, timeoutMs: 30_000 }).then(() => undefined, gitWords)
    : undefined;
  const head = oid && (await have(oid)) ? [oid] : [];
  const count = async (pushed: string[]) => Number((await git(exec, at.cwd, ["rev-list", "--count", tip, "--not", "--remotes", ...head, ...pushed])).trim());
  let ahead = await count([]);
  // The commit the worktree was made at counts as pushed only once GitHub is found to have it: a review worktree made
  // by hand on a commit never pushed would otherwise go, with its branch.
  let unread = "";
  if (ahead > 0 && o.onGitHub) {
    const made = await madeAt(exec, at.cwd, at.reflog, wt.missing ? tip : undefined);
    const known = made ? await o.onGitHub(made).catch((e: unknown) => (e instanceof Error ? e.message : "GitHub を読めませんでした。")) : false;
    if (made && known === true) ahead = await count([made]);
    else if (typeof known === "string") unread = known;
  }
  if (ahead > 0 && unfetched) {
    throw new ReviewError(`Pull request #${pr.number} の head を取ってこられなかったので、${wt.path} の ${ahead} 個の commit が push 済みかを確かめられません。片付けません：${unfetched}`);
  }
  if (ahead > 0 && unread) throw new ReviewError(`GitHub を読めなかったので、${wt.path} の ${ahead} 個の commit が push 済みかを確かめられません。片付けません：${unread}`);
  if (ahead > 0) throw new ReviewError(`${wt.path} に、push していない commit が ${ahead} 個あるので、片付けません。`);
  await step("worktree を消すことが", git(exec, clone.path, ["worktree", "remove", wt.path], { write: true }));
  if (wt.branch) await step(`worktree は消しましたが、ローカルのブランチ ${wt.branch} を消すことが`, git(exec, clone.path, ["branch", "-D", wt.branch], { write: true }));
  return { path: wt.path, ...(wt.branch ? { branch: wt.branch } : {}) };
}
