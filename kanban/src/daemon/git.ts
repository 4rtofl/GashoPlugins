// Reading a repository for the kanban (moved here from Gasho's apps/daemon/src/kanban.ts of PR #8): its worktrees with
// git, and my open and closed pull requests with the GitHub CLI (gh) of the working server, logged in as whoever runs
// gasho-daemon. Only reads. Both run through the daemon part's context (ctx.exec): no shell, no terminal, no prompts.
import fs from "node:fs/promises";
import path from "node:path";
import type { DaemonStartContext } from "@gasho/plugin-sdk/daemon";
import type { ClosedPr, OpenPr, RepoMaterial, RepoOption } from "../types.ts";

export type Exec = DaemonStartContext["exec"];

/** The GitHub CLI: as gasho-daemon is told (GASHO_GH_BIN), or gh. */
const GH = process.env.GASHO_GH_BIN || "gh";
const PR_LIMIT = 100;
const PR_FIELDS = "number,title,url,headRefName,isDraft,updatedAt";
const CLOSED_FIELDS = "number,headRefName,state,title,url";

/** What went wrong with a repository, for the person looking at the board. */
export class KanbanError extends Error {}

// ---- what git and gh give ----

/** `git worktree list --porcelain`: the primary checkout first, then the worktrees on a branch (detached ones are left out). */
export function parseWorktrees(porcelain: string): { primary?: { path: string; branch?: string; bare?: boolean }; worktrees: { branch: string; path: string }[] } {
  let primary: { path: string; branch?: string; bare?: boolean } | undefined;
  const worktrees: { branch: string; path: string }[] = [];
  let current: string | undefined;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = line.slice("worktree ".length);
      primary ??= { path: current };
    } else if (line === "bare" && primary && current === primary.path) {
      primary.bare = true;
    } else if (line.startsWith("branch refs/heads/") && current) {
      const branch = line.slice("branch refs/heads/".length);
      if (current === primary?.path) primary.branch = branch;
      else worktrees.push({ branch, path: current });
    }
  }
  return { primary, worktrees };
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
      },
    ];
  });
}

/** Of each branch, the newest closed pull request. */
export function parseClosed(data: unknown): ClosedPr[] {
  const rows = (Array.isArray(data) ? data : []).flatMap((p): ClosedPr[] =>
    isRecord(p) && typeof p.number === "number" && typeof p.headRefName === "string" && typeof p.state === "string" && githubUrl(p.url)
      ? [{ number: p.number, headRefName: p.headRefName, state: p.state, title: typeof p.title === "string" ? p.title : "", url: p.url }]
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

async function ghJson(exec: Exec, args: string[]): Promise<unknown> {
  const { stdout } = await exec(GH, args, { timeoutMs: 30_000, maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(stdout) as unknown;
}

async function realPath(p: string): Promise<string> {
  return fs.realpath(p).catch(() => p);
}

/**
 * The repositories in `folders` (those Gasho can start sessions in), one per repository however many of its worktrees
 * are there, by their primary checkout. Folders that are not in a repository and bare repositories are left out. Only
 * these can be watched: git runs in a repository's folder, so never in one a browser made up.
 */
export async function repoOptions(exec: Exec, folders: readonly string[]): Promise<RepoOption[]> {
  const found = new Map<string, RepoOption>();
  for (const dir of folders) {
    const common = await git(exec, dir, ["rev-parse", "--git-common-dir"]).then((s) => path.resolve(dir, s.trim()), () => undefined);
    if (!common || found.has(common)) continue;
    const primary = await git(exec, dir, ["worktree", "list", "--porcelain"]).then((s) => parseWorktrees(s).primary, () => undefined);
    if (!primary || primary.bare) continue;
    const github = await git(exec, primary.path, ["remote", "get-url", "origin"]).then(parseGitHubUrl, () => undefined);
    found.set(common, { path: primary.path, ...(github ? { github } : {}) });
  }
  // Those on GitHub first: the others cannot be watched.
  return [...found.values()].sort((a, b) => Number(!a.github) - Number(!b.github) || (a.github ?? a.path).localeCompare(b.github ?? b.path));
}

/** Reads one watched repository: its worktrees, and my open and closed pull requests. */
export async function readRepo(exec: Exec, option: RepoOption): Promise<RepoMaterial> {
  const github = option.github;
  if (!github) throw new KanbanError("origin が GitHub の repo ではないので、見られません。");
  const porcelain = await git(exec, option.path, ["worktree", "list", "--porcelain"]).catch((e: unknown) => {
    throw new KanbanError(`Git の情報を読めませんでした：${String(e instanceof Error ? e.message : e).split("\n")[0]}`);
  });
  const { primary, worktrees } = parseWorktrees(porcelain);
  if (!primary) throw new KanbanError("worktree の一覧を読めませんでした。");
  const list = (state: string, fields: string) =>
    ghJson(exec, ["pr", "list", "--repo", github, "--author", "@me", "--state", state, "--limit", String(PR_LIMIT), "--json", fields]);
  const [open, closed] = await Promise.all([list("open", PR_FIELDS), list("closed", CLOSED_FIELDS)]).catch((e: unknown) => {
    throw new KanbanError(ghError(e));
  });
  return {
    repo: github,
    primary: { path: await realPath(primary.path), ...(primary.branch ? { branch: primary.branch } : {}) },
    worktrees: await Promise.all(worktrees.map(async (w) => ({ branch: w.branch, path: await realPath(w.path) }))),
    prs: parsePrs(open),
    closed: parseClosed(closed),
  };
}
