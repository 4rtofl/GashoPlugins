// How Session List Rewind puts the sidebar's sessions in categories: one per repository on each working server, and
// one per folder for the sessions outside a repository (Gasho's docs/plugins.md, P17). The sessions come the one used
// last first, so the categories come out in the order they were last used, and the sessions in each too. Gasho draws
// them, and puts over this order the one the person dragged things into.
import type { MachineInfo, SessionCategory, SessionListContext, SessionListWorktree } from "@gasho/plugin-sdk";

const basename = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

/** A worktree's name under a session: its branch, or its folder's name (HEAD detached, or outside a repository). */
const worktreeName = (w: SessionListWorktree) => w.branch ?? basename(w.path);

/** The ends of the paths (as lists of folder names), as far up as it takes to tell them apart; at the top, the whole path. */
function pathEnds(paths: readonly string[][]): string[] {
  for (let n = 1; ; n++) {
    const labels = paths.map((p) => (n >= p.length ? `/${p.join("/")}` : `…/${p.slice(-n).join("/")}`));
    if (new Set(labels).size === labels.length || paths.every((p) => n >= p.length)) return labels;
  }
}

/** Whether a word starts at k: at a mark (/, -, _, . or a space), where small letters turn to a capital, or letters to
 * digits and back. */
function wordStart(s: string, k: number): boolean {
  const c = s[k]!;
  const b = s[k - 1];
  if (!/[\p{L}\p{N}]/u.test(c)) return true;
  if (b === undefined || !/[\p{L}\p{N}]/u.test(b)) return false;
  return (/\p{Lu}/u.test(c) && /\p{Ll}/u.test(b)) || /\p{N}/u.test(c) !== /\p{N}/u.test(b);
}

/**
 * The labels without the start they share with another, from the word where they differ: …/GashoPlugins and …-fork
 * for …/GashoPlugins and …/GashoPlugins-fork. Gasho cuts a heading's description at its end, so on a phone only its
 * start shows. A label the start of another stays whole, and so does one whose rest another path ends with.
 */
function shorten(labels: readonly string[], paths: readonly string[]): string[] {
  return labels.map((l, i) => {
    const same = Math.max(0, ...labels.map((m, j) => {
      let n = 0;
      while (i !== j && n < l.length && l[n] === m[n]) n++;
      return n;
    }));
    if (same >= l.length) return l;
    let k = same;
    while (k > 1 && !wordStart(l, k)) k--;
    const rest = l.slice(k);
    return k > 1 && !paths.some((p, j) => j !== i && p.endsWith(rest)) ? `…${rest}` : l;
  });
}

/**
 * For folders of the same name, where each is: the end of the path of the folder it is in, as far up as it takes to
 * tell them apart (…/Project and …/GashoPlugins for /u/Project/GashoPlugins and /u/Project/GashoPlugins/GashoPlugins).
 * When two are in one folder (clones side by side, both named after the repository on GitHub), the end of its own path
 * (…/Gasho and …-fork for /u/repos/Gasho and /u/repos/Gasho-fork).
 */
function folderLabels(folders: readonly string[]): string[] {
  const paths = folders.map((f) => f.split("/").filter(Boolean));
  const parents = paths.map((p) => p.slice(0, -1));
  const by = new Set(parents.map((p) => p.join("/"))).size === parents.length ? parents : paths;
  return shorten(pathEnds(by), by.map((p) => `/${p.join("/")}`));
}

interface Category {
  id: string;
  machine: MachineInfo;
  /** The repository's folder (of its main worktree), or the folder outside a repository. */
  folder: string;
  title: string;
  hint: string;
  /** Its worktrees, the one of the session used last first. */
  worktrees: SessionListWorktree[];
  sessions: { machine: string; sessionId: string; worktree: SessionListWorktree }[];
}

export function categories(ctx: SessionListContext): SessionCategory[] {
  const worktrees = new Map(ctx.worktrees.map((w) => [w.key, w]));
  // The working server's name goes with the repository's when there are several, as in Gasho's own list.
  const several = ctx.machines.length > 1;
  const byId = new Map<string, Category>();
  const categoryOf = (w: SessionListWorktree): Category => {
    const folder = w.repo ?? w.path;
    // The same whenever drawn: Gasho keeps the dragged order and the folding by it.
    const id = `${w.machine.id}\u001f${folder}`;
    let c = byId.get(id);
    if (!c) {
      c = {
        id,
        machine: w.machine,
        folder,
        title: w.repoName ?? basename(folder),
        hint: `${w.machine.name} · ${folder}`,
        worktrees: [],
        sessions: [],
      };
      byId.set(id, c);
    }
    if (!c.worktrees.includes(w)) c.worktrees.push(w);
    return c;
  };
  for (const s of ctx.sessions) {
    const w = worktrees.get(s.worktree);
    // Gasho gives every session's worktree; a session without one would go in Gasho's "その他".
    if (w) categoryOf(w).sessions.push({ machine: s.machine.id, sessionId: s.session.sessionId, worktree: w });
  }
  // A repository registered with its working server has its category even without a session, for its "＋".
  for (const w of ctx.worktrees) if (w.registered) categoryOf(w);
  const all = [...byId.values()];

  // Headings of the same name on a working server (a folder outside a repository and the repository in it, a fork and
  // its upstream in two clones) tell the folder they are in, shown even on a phone, where the hint is not.
  const sameName = new Map<string, Category[]>();
  for (const c of all) {
    const k = `${c.machine.id}\u001f${c.title}`;
    sameName.set(k, [...(sameName.get(k) ?? []), c]);
  }
  const where = new Map<string, string>();
  for (const cs of sameName.values()) {
    if (cs.length < 2) continue;
    const labels = folderLabels(cs.map((c) => c.folder));
    cs.forEach((c, i) => where.set(c.id, labels[i]!));
  }

  return all.map((c) => {
    // The folder goes before the server's name: on a phone, only the start of the description shows.
    const description = [where.get(c.id), several ? c.machine.name : undefined].filter(Boolean).join(" · ");
    // The worktree a session is in is told only when they are not all in one.
    const spread = new Set(c.sessions.map((s) => s.worktree.key)).size > 1;
    // "＋" starts in the repository's main worktree; without it here (a bare repository), in the one used last.
    const launch = c.worktrees.find((w) => w.path === c.folder) ?? c.worktrees[0];
    return {
      id: c.id,
      title: c.title,
      ...(description ? { description } : {}),
      hint: c.hint,
      ...(launch ? { launch: launch.key } : {}),
      sessions: c.sessions.map((s) => ({
        machine: s.machine,
        sessionId: s.sessionId,
        ...(spread ? { description: worktreeName(s.worktree) } : {}),
      })),
    };
  });
}
