// A worktree's HEAD commit, which tells the merged pull requests of its branch from those merged before from a branch
// of the same name (gh.ts, parseItems), and its branch. git runs only in a folder Gasho can start sessions in
// (ctx.folders: those Claude Code trusts): the worktree's folders from the browser are only compared with them and with
// what git lists. Claude Code trusts a repository's main worktree rather than each of its worktrees, so they are mostly
// found in its list.
import type { DaemonContext } from "@gasho/plugin-sdk/daemon";

export const trimSlash = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/** A worktree as git lists it. */
export interface ListedWorktree {
  head: string;
  /** Absent when its HEAD is detached. */
  branch?: string;
}

/** `git worktree list --porcelain` by each worktree's top folder. */
export function parseWorktreeList(porcelain: string): Map<string, ListedWorktree> {
  const listed = new Map<string, ListedWorktree>();
  let at: string | undefined;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) at = trimSlash(line.slice("worktree ".length));
    else if (at && /^HEAD [0-9a-f]{40,64}$/.test(line)) listed.set(at, { head: line.slice("HEAD ".length) });
    else if (at && line.startsWith("branch refs/heads/")) {
      const w = listed.get(at);
      if (w) w.branch = line.slice("branch refs/heads/".length);
    }
  }
  return listed;
}

/** The lists of one operation, by folder: one git run per repository however many of its worktrees are asked about. */
export type WorktreeLists = Map<string, Promise<Map<string, ListedWorktree> | undefined>>;

/**
 * The worktree at `worktree`, whose main worktree is `repoDir`, as git lists it; undefined when no folder of Gasho's
 * lists it.
 */
export async function listedWorktree(
  ctx: Pick<DaemonContext, "exec" | "folders" | "log">,
  worktree: string,
  repoDir: string | undefined,
  lists: WorktreeLists = new Map(),
): Promise<ListedWorktree | undefined> {
  const asked = new Set([worktree, repoDir].flatMap((p) => (p ? [trimSlash(p)] : [])));
  for (const dir of new Set(ctx.folders().map(trimSlash).filter((f) => asked.has(f)))) {
    let list = lists.get(dir);
    if (!list) {
      list = ctx.exec("git", ["-C", dir, "worktree", "list", "--porcelain"], { timeoutMs: 10_000, env: { GIT_OPTIONAL_LOCKS: "0" } }).then(
        ({ stdout }) => parseWorktreeList(stdout),
        (e: unknown) => {
          ctx.log(`could not list the worktrees of ${dir}`, e);
          return undefined;
        },
      );
      lists.set(dir, list);
    }
    const w = (await list)?.get(trimSlash(worktree));
    if (w) return w;
  }
  return undefined;
}
