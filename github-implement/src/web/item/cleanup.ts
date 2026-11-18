// What the merged section (sections/merged.tsx) needs to know before it offers removing a worktree, apart from Gasho:
// whether the screen is open in the worktree of the merged pull request's head branch, the sessions that end with it,
// and how to say why gasho-daemon would not remove it yet. Kept free of the SDK's functions, so the tests can run it.
import type { MachineInfo, SessionInfo, WorktreeInfo } from "@gasho/plugin-sdk";
import type { GitHubItemDetail, WorktreeItems } from "../../types.ts";

/** Why gasho-daemon did not remove a worktree (the SDK's WorktreeChanges). */
export interface Changes {
  /** Uncommitted changes, untracked files included. */
  uncommitted: number;
  /** Commits on no remote and in none of the commits passed as pushed. */
  unpushed: number;
}

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/**
 * Whether the merged section shows for this worktree: a merged pull request, opened in a worktree that has its head
 * branch checked out and is not its repository's main worktree (which cannot be removed), and that the worktree's items
 * (`items`, ops/items.ts) count among its branch's pull requests: one merged before from a branch of the same name, or
 * from a fork's, is not. Another branch's worktree, the main one, or a folder outside a repository shows nothing.
 */
export function isMergedHeadWorktree(item: GitHubItemDetail, worktree: Pick<WorktreeInfo, "path" | "branch" | "repo">, items: WorktreeItems | undefined): boolean {
  if (item.kind !== "pulls" || item.state !== "merged" || !item.head) return false;
  if (worktree.branch !== item.head || !worktree.repo) return false;
  if (!items?.pulls.some((p) => p.number === item.number)) return false;
  return trimSlash(worktree.path) !== trimSlash(worktree.repo);
}

/**
 * The sessions that end with the worktree, as Gasho's own dialog lists them: every session of the working server whose
 * folder is the worktree or inside it, those started outside Gasho too.
 */
export function sessionsIn(machine: Pick<MachineInfo, "sessions">, path: string): SessionInfo[] {
  const top = trimSlash(path);
  return machine.sessions.filter((s) => {
    const cwd = trimSlash(s.cwd);
    return cwd === top || cwd.startsWith(`${top}/`);
  });
}

/** A session as the dialog names it. */
export function sessionName(s: Pick<SessionInfo, "sessionId" | "name" | "title">): string {
  return s.name?.trim() || s.title?.trim() || s.sessionId.slice(0, 8);
}

/** Why it was not removed, in a sentence ("未コミットの変更が 2 件と、push していない commit が 1 件あります。"). */
export function changesText(c: Changes): string {
  const parts = [c.uncommitted > 0 && `未コミットの変更が ${c.uncommitted} 件`, c.unpushed > 0 && `push していない commit が ${c.unpushed} 件`].filter(Boolean);
  if (parts.length === 0) return "消すと失われる変更があります。";
  return `${parts.join("と、")}あります。`;
}

/** The commits gasho-daemon counts as pushed: the pull request's head, which GitHub keeps after a squash merge too. */
export function pushedOf(item: Pick<GitHubItemDetail, "headOid">): string[] | undefined {
  return item.headOid ? [item.headOid] : undefined;
}
