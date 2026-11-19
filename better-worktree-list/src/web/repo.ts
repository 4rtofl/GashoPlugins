// 「リポジトリごと」: the sidebar's worktrees in one category per repository on each working server, and one per working
// server for the folders outside a repository (「リポジトリの外」). Gasho gives the worktrees the one used last first,
// then those without sessions, so the categories come out in the order they were last used (those with no worktree
// used last), and the worktrees in each too. Gasho draws them, and puts over this order the one the person dragged
// things into (docs/plugins.md of Gasho, P18).
import type { MachineInfo, WorktreeCategory, WorktreeListContext, WorktreeListWorktree } from "@gasho/plugin-sdk";

const basename = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

interface Category {
  id: string;
  machine: MachineInfo;
  /** The repository's folder (of its main worktree); absent outside a repository, and when only its name is known. */
  folder?: string;
  outside: boolean;
  title: string;
  hint: string;
  worktrees: WorktreeListWorktree[];
}

/** The ends of the paths (as lists of folder names), as far up as it takes to tell them apart; at the top, the whole path. */
function pathEnds(paths: readonly string[][]): string[] {
  for (let n = 1; ; n++) {
    const labels = paths.map((p) => (n >= p.length ? `/${p.join("/")}` : `…/${p.slice(-n).join("/")}`));
    if (new Set(labels).size === labels.length || paths.every((p) => n >= p.length)) return labels;
  }
}

/**
 * For folders of the same name, the end of the path of the folder each is in, as far up as it takes to tell them apart:
 * …/Project and …/GashoPlugins for /u/Project/GashoPlugins and /u/Project/GashoPlugins/GashoPlugins. When the folders
 * they are in do not tell them apart (clones side by side, both named after the repository on GitHub), the end of their
 * own paths: …/Gasho and …/Gasho-fork for /u/repos/Gasho and /u/repos/Gasho-fork.
 */
function folderLabels(folders: readonly string[]): string[] {
  const paths = folders.map((f) => f.split("/").filter(Boolean));
  const parents = pathEnds(paths.map((p) => p.slice(0, -1)));
  return new Set(parents).size === parents.length ? parents : pathEnds(paths);
}

export function repoCategories(ctx: WorktreeListContext): WorktreeCategory[] {
  // The working server's name goes with the repository's when there are several, as in Gasho's own list.
  const several = ctx.machines.length > 1;
  // A worktree whose repository's folder is not known (from an older gasho-daemon, or remembered by an older Gasho)
  // goes in the category of the repository of its name, when its working server has one alone.
  const foldersByName = new Map<string, Set<string>>();
  for (const w of ctx.worktrees) {
    if (!w.repo) continue;
    const name = `${w.machine.id}\u001f${w.repoName ?? basename(w.repo)}`;
    foldersByName.set(name, (foldersByName.get(name) ?? new Set()).add(w.repo));
  }
  const byId = new Map<string, Category>();
  for (const w of ctx.worktrees) {
    const named = !w.repo && w.repoName ? foldersByName.get(`${w.machine.id}\u001f${w.repoName}`) : undefined;
    const folder = w.repo ?? (named?.size === 1 ? [...named][0] : undefined);
    // The same whenever drawn and in the next versions: Gasho keeps the dragged order and the folding by it.
    const id =
      folder !== undefined
        ? `${w.machine.id}\u001f${folder}`
        : w.repoName
          ? `${w.machine.id}\u001f\u001fname\u001f${w.repoName}`
          : `${w.machine.id}\u001f\u001foutside`;
    let c = byId.get(id);
    if (!c) {
      c =
        folder !== undefined
          ? { id, machine: w.machine, folder, outside: false, title: w.repoName ?? basename(folder), hint: `${w.machine.name} · ${folder}`, worktrees: [] }
          : w.repoName
            ? { id, machine: w.machine, outside: false, title: w.repoName, hint: `${w.machine.name} · ${w.repoName}`, worktrees: [] }
            : { id, machine: w.machine, outside: true, title: "リポジトリの外", hint: `${w.machine.name} · リポジトリの外のフォルダー`, worktrees: [] };
      byId.set(id, c);
    }
    c.worktrees.push(w);
  }
  const categories = [...byId.values()];

  // Headings of the same name on a working server (a fork and its upstream in two clones) tell the folder they are in,
  // shown even on a phone, where the hint is not.
  const sameName = new Map<string, Category[]>();
  for (const c of categories) {
    if (c.outside) continue;
    const k = `${c.machine.id}\u001f${c.title}`;
    sameName.set(k, [...(sameName.get(k) ?? []), c]);
  }
  const where = new Map<string, string>();
  for (const cs of sameName.values()) {
    if (cs.length < 2) continue;
    // A category of the name alone has no folder of its own: told by a fixed word, not by a worktree in it, which would
    // change with the one used last and could match another heading's folder.
    const withFolder = cs.filter((c) => c.folder !== undefined);
    const labels = folderLabels(withFolder.map((c) => c.folder!));
    withFolder.forEach((c, i) => where.set(c.id, labels[i]!));
    for (const c of cs) if (c.folder === undefined) where.set(c.id, "フォルダー不明");
  }

  return categories.map((c) => {
    const description = [several ? c.machine.name : undefined, where.get(c.id)].filter(Boolean).join(" · ");
    // "＋" starts in the repository's main worktree; without it here (a bare repository, or only its name known), in
    // the one used last.
    const launch = c.outside ? undefined : (c.worktrees.find((w) => w.path === c.folder) ?? c.worktrees[0]);
    return {
      id: c.id,
      title: c.title,
      ...(description ? { description } : {}),
      hint: c.hint,
      ...(launch ? { launch: launch.key } : {}),
      // No second line: the heading names the repository.
      worktrees: c.worktrees.map((w) => ({ key: w.key, description: "" })),
    };
  });
}
