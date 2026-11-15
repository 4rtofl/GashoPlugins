// How Session List Rewind puts the sidebar's sessions in categories: one per repository on each working server, and
// one per folder for the sessions outside a repository (Gasho's docs/plugins.md, P17). The sessions come the one used
// last first, so the categories come out in the order they were last used, and the sessions in each too. Gasho draws
// them, and puts over this order the one the person dragged things into.
import type { SessionCategory, SessionListContext, SessionListWorktree } from "@gasho/plugin-sdk";

const basename = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

/** A worktree's name under a session: its branch, or its folder's name (HEAD detached, or outside a repository). */
const worktreeName = (w: SessionListWorktree) => w.branch ?? basename(w.path);

interface Category {
  id: string;
  /** The repository's folder (of its main worktree), or the folder outside a repository. */
  folder: string;
  title: string;
  description?: string;
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
        folder,
        title: w.repoName ?? basename(folder),
        ...(several ? { description: w.machine.name } : {}),
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

  return [...byId.values()].map((c) => {
    // The worktree a session is in is told only when they are not all in one.
    const spread = new Set(c.sessions.map((s) => s.worktree.key)).size > 1;
    // "＋" starts in the repository's main worktree; without it here (a bare repository), in the one used last.
    const launch = c.worktrees.find((w) => w.path === c.folder) ?? c.worktrees[0];
    return {
      id: c.id,
      title: c.title,
      ...(c.description ? { description: c.description } : {}),
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
