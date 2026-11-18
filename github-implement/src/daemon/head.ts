// A worktree's HEAD commit, which tells the merged pull requests of its branch from those merged before from a branch
// of the same name (gh.ts, parseItems). git runs only in a folder Gasho can start sessions in (ctx.folders: those Claude
// Code trusts): the worktree's folders from the browser are only compared with them and with what git lists. Claude
// Code trusts a repository's main worktree rather than each of its worktrees, so they are mostly found in its list.
import type { DaemonContext } from "@gasho/plugin-sdk/daemon";

const trimSlash = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/** `git worktree list --porcelain` as each worktree's top folder and HEAD commit. */
export function worktreeHeads(porcelain: string): Map<string, string> {
  const heads = new Map<string, string>();
  let at: string | undefined;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) at = trimSlash(line.slice("worktree ".length));
    else if (at && /^HEAD [0-9a-f]{40,64}$/.test(line)) heads.set(at, line.slice("HEAD ".length));
  }
  return heads;
}

/** The HEAD of the worktree at `worktree`, whose main worktree is `repoDir`; undefined when no folder of Gasho's lists it. */
export async function worktreeHead(ctx: Pick<DaemonContext, "exec" | "folders" | "log">, worktree: string, repoDir: string | undefined): Promise<string | undefined> {
  const asked = new Set([worktree, repoDir].flatMap((p) => (p ? [trimSlash(p)] : [])));
  for (const dir of new Set(ctx.folders().map(trimSlash).filter((f) => asked.has(f)))) {
    try {
      const { stdout } = await ctx.exec("git", ["-C", dir, "worktree", "list", "--porcelain"], { timeoutMs: 10_000, env: { GIT_OPTIONAL_LOCKS: "0" } });
      const head = worktreeHeads(stdout).get(trimSlash(worktree));
      if (head) return head;
    } catch (e) {
      ctx.log(`could not list the worktrees of ${dir}`, e);
    }
  }
  return undefined;
}
