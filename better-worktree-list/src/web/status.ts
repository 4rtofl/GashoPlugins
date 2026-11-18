// 「作業中・待機中」: the sidebar's worktrees in categories by their state, the one their rows' dots show: 確認待ち (a session
// waits for an answer: a permission, a question, a plan), 作業中 (Claude works in a session), 待機中 (Claude waits for
// the next instruction), オフライン (the working server is offline) and セッションなし (a worktree the sidebar keeps once
// its sessions are gone, or one of a registered repository). In each, the worktrees come in Gasho's order, the one used
// last first; their second line is Gasho's (the repository's name).
import type { WorktreeCategory, WorktreeListContext, WorktreeListWorktree } from "@gasho/plugin-sdk";

const STATES = [
  { id: "waiting", title: "確認待ち", hint: "権限の確認、質問への回答、計画の承認を待っているセッションのある worktree" },
  { id: "busy", title: "作業中", hint: "Claude が作業しているセッションのある worktree" },
  { id: "idle", title: "待機中", hint: "Claude が次の指示を待っている worktree" },
  { id: "offline", title: "オフライン", hint: "working server がつながっていない、セッションのある worktree" },
  {
    id: "none",
    title: "セッションなし",
    hint: "セッションの無い worktree（セッションが終わったものと、登録したリポジトリのもの。working server がつながっていないものも入る）",
  },
] as const;

export type State = (typeof STATES)[number]["id"];

/** A worktree's category: none without sessions, offline with its working server, else its row's state. */
export function stateOf(w: WorktreeListWorktree): State {
  if (w.sessions.length === 0) return "none";
  if (!w.machine.connected) return "offline";
  // A session whose turn has ended while work runs on in the background is busy here, as Gasho's dots show it.
  if (w.status === "waiting" || w.status === "busy") return w.status;
  return "idle";
}

export function statusCategories(ctx: WorktreeListContext): WorktreeCategory[] {
  if (ctx.worktrees.length === 0) return [];
  const byState = new Map<State, WorktreeListWorktree[]>();
  for (const w of ctx.worktrees) {
    const state = stateOf(w);
    byState.set(state, [...(byState.get(state) ?? []), w]);
  }
  // Every category, even with no worktree (a heading alone): Gasho remembers the order dragged into only for the
  // categories shown then, and puts one that comes later first.
  return STATES.map((s) => ({ id: s.id, title: s.title, hint: s.hint, worktrees: (byState.get(s.id) ?? []).map((w) => ({ key: w.key })) }));
}
