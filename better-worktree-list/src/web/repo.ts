// 「リポジトリごと」: the sidebar's worktrees in one category per repository on each working server, and one per working
// server for the folders outside a repository (「リポジトリの外」). Gasho gives the worktrees the one used last first,
// then those without sessions, so the categories come out in the order they were last used (those with no worktree
// used last), and the worktrees in each too. Gasho draws them, and puts over this order the one the person dragged
// things into (docs/plugins.md of Gasho, P18).
import type { WorktreeCategory, WorktreeListContext, WorktreeListWorktree } from "@gasho/plugin-sdk";

const basename = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

interface Category {
  id: string;
  /** The repository's folder (of its main worktree); absent for the folders outside a repository. */
  folder?: string;
  title: string;
  description?: string;
  hint: string;
  worktrees: WorktreeListWorktree[];
}

export function repoCategories(ctx: WorktreeListContext): WorktreeCategory[] {
  // The working server's name goes with the repository's when there are several, as in Gasho's own list.
  const several = ctx.machines.length > 1;
  const byId = new Map<string, Category>();
  for (const w of ctx.worktrees) {
    // The same whenever drawn and in the next versions: Gasho keeps the dragged order and the folding by it.
    const id = w.repo ? `${w.machine.id}\u001f${w.repo}` : `${w.machine.id}\u001f\u001foutside`;
    let c = byId.get(id);
    if (!c) {
      c = w.repo
        ? { id, folder: w.repo, title: w.repoName ?? basename(w.repo), hint: `${w.machine.name} · ${w.repo}`, worktrees: [] }
        : { id, title: "リポジトリの外", hint: `${w.machine.name} · リポジトリの外のフォルダー`, worktrees: [] };
      if (several) c.description = w.machine.name;
      byId.set(id, c);
    }
    c.worktrees.push(w);
  }
  return [...byId.values()].map((c) => {
    // "＋" starts in the repository's main worktree; without it here (a bare repository), in the one used last.
    const launch = c.folder === undefined ? undefined : (c.worktrees.find((w) => w.path === c.folder) ?? c.worktrees[0]);
    return {
      id: c.id,
      title: c.title,
      ...(c.description ? { description: c.description } : {}),
      hint: c.hint,
      ...(launch ? { launch: launch.key } : {}),
      // No second line: the heading names the repository.
      worktrees: c.worktrees.map((w) => ({ key: w.key, description: "" })),
    };
  });
}
