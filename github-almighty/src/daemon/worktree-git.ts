// What the worktree operations (ops/worktrees.ts, ops/worktree.ts) share: the checks of the folders that come from the
// browser, and git in a repository's folder. git runs only in folders where Gasho can start sessions (ctx.folders()),
// as a path from the browser must never make gasho-daemon touch any folder of the working server.
import path from "node:path";
import { PluginError, type DaemonContext } from "@gasho/plugin-sdk/daemon";

export type GitCtx = Pick<DaemonContext, "exec" | "folders" | "log">;

/** A folder as the browser named it: absolute, already normalized (no "..", no trailing "/"). */
export function folderArg(v: unknown, what: string): string {
  if (typeof v !== "string" || v.length > 1000 || !v.startsWith("/") || v.includes("\0") || path.posix.normalize(v) !== v || (v !== "/" && v.endsWith("/"))) {
    throw new PluginError(`${what}の指定が正しくありません。`);
  }
  return v;
}

/** Whether `dir` is one of `folders` or inside one. */
export function inFolders(dir: string, folders: string[]): boolean {
  return folders.some((f) => {
    const base = f.length > 1 && f.endsWith("/") ? f.slice(0, -1) : f;
    return dir === base || dir.startsWith(base === "/" ? "/" : `${base}/`);
  });
}

/**
 * `dir`, when it is in a folder Gasho starts sessions in, or in one of `also`; else a PluginError. ctx.folders() holds
 * only the folders Claude Code trusts (the screen adds their parents), so a worktree beside a trusted repository is
 * allowed through `also` (the repository's parent).
 */
export function allowed(ctx: Pick<DaemonContext, "folders">, dir: string, what: string, also: string[] = []): string {
  if (!inFolders(dir, [...ctx.folders(), ...also])) throw new PluginError(`${what}（${dir}）は、Gasho がセッションを起動できるフォルダーの外にあります。`);
  return dir;
}

export interface GitWorktree {
  path: string;
  /** Absent when HEAD is detached. */
  branch?: string;
}

/** `git worktree list --porcelain`: the main worktree first. Bare entries and those git calls prunable are left out. */
export function parseWorktrees(porcelain: string): GitWorktree[] {
  const out: GitWorktree[] = [];
  for (const block of porcelain.split(/\n\n+/)) {
    const lines = block.split("\n");
    const p = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
    if (!p || lines.includes("bare") || lines.some((l) => l.startsWith("prunable"))) continue;
    const ref = lines.find((l) => l.startsWith("branch "))?.slice("branch ".length);
    out.push({ path: p, ...(ref?.startsWith("refs/heads/") ? { branch: ref.slice("refs/heads/".length) } : {}) });
  }
  return out;
}

/** The remote whose URL is the GitHub repository `repo` (owner/name), else "origin". */
export function remoteOf(remotes: string, repo: string): string {
  const want = repo.toLowerCase();
  for (const line of remotes.split("\n")) {
    const [name, url] = line.split(/\s+/);
    const m = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i.exec(url ?? "");
    if (name && m?.[1]?.toLowerCase() === want) return name;
  }
  return "origin";
}

/** git in the folder `dir`. A fetch may take a while; the rest is quick. */
export function git(ctx: GitCtx, dir: string) {
  return (args: string[], timeoutMs = 15_000) => ctx.exec("git", ["-C", dir, ...args], { timeoutMs });
}

/** git's own message for a failure, for the screen. */
export function gitError(e: unknown): string {
  const err = (e as { stderr?: unknown } | null)?.stderr;
  const text = typeof err === "string" ? err.trim() : "";
  const line = text.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("hint:")).pop();
  return line ? `git が失敗しました：${line.replace(/^(fatal|error):\s*/, "")}` : "git が失敗しました。";
}
