// What every part of one item's screen shares (useItem): the item as last read, where it is, the clock, and running a
// change. A change is one operation of the daemon part; when it is done, a toast says so (an Undo Toast when it can be
// put back), and the item, the worktree's tabs and what the parts read themselves (useAfterChange) are read again. What
// is typed on the screen (useDraft) stays while the page is open, and goes when the worktree's screen shows another number.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePluginState, type MachineInfo, type WorktreeInfo } from "@gasho/plugin-sdk";
import type { GitHubItemDetail, GitHubKind } from "../../types.ts";
import { useWriteOp } from "../daemon.ts";
import { useToast } from "../ui/toast.tsx";

export interface Where {
  repo: string;
  kind: GitHubKind;
  number: number;
}

export interface Change {
  /** Which button shows that it runs (busy). */
  id: string;
  /** The operation of src/daemon/ops, and its parameters besides `where`. */
  op: string;
  params: Record<string, unknown>;
  /** For Gasho's operation log: what it does ("#17 の担当から octocat を外す"). */
  summary: string;
  /** The toast once it is done ("担当から octocat を外しました"). */
  done: string;
  /** The change that puts it back, offered on an Undo Toast. */
  undo?: { op: string; params: Record<string, unknown>; summary: string };
}

export interface ItemScope {
  machine: string;
  /** The working server as Gasho knows it now (online, its sessions). */
  machineInfo: MachineInfo;
  /** The worktree the screen is open in. */
  worktree: WorktreeInfo;
  where: Where;
  item: GitHubItemDetail;
  now: number;
  /** The id of the change that runs, if one does. One runs at a time. */
  busy?: string;
  run(change: Change): Promise<boolean>;
  /** Grows after every change and every reload. */
  revision: number;
  /** Reads the item, the tabs and every part again from GitHub (the reload button). */
  reload(): void;
}

const ItemContext = createContext<ItemScope | undefined>(undefined);

export const ItemProvider = ItemContext.Provider;

export function useItem(): ItemScope {
  const scope = useContext(ItemContext);
  if (!scope) throw new Error("useItem is for the parts of an item's screen");
  return scope;
}

/** Calls `reload` after every change made on the screen and every press of its reload button, for what a part reads itself. */
export function useAfterChange(reload: () => void): void {
  const { revision } = useItem();
  const first = useRef(revision);
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    if (revision !== first.current) latest.current();
  }, [revision]);
}

/** What is typed on the screen of a worktree, by name, and the issue or pull request it is typed for. */
interface Drafts {
  at: string;
  values: Record<string, unknown>;
}

const draftsKey = (machine: string, worktree: WorktreeInfo) => `drafts:${machine}:${worktree.path}`;
const draftsAt = (where: Where) => `${where.kind}#${where.number}`;

/**
 * A draft of the screen (a title, a comment, …), or undefined when none is being written. Gasho keeps it while the page
 * is open, so it stays when another tab of the screen (whose content is made anew) or a session's tab is chosen and
 * then this one again.
 */
export function useDraft<T>(name: string): [T | undefined, (next: T | undefined | ((prev: T | undefined) => T | undefined)) => void] {
  const { machine, worktree, where } = useItem();
  const at = draftsAt(where);
  const [drafts, setDrafts] = usePluginState<Drafts | undefined>(draftsKey(machine, worktree), undefined);
  const value = drafts?.at === at ? (drafts.values[name] as T | undefined) : undefined;
  // A change sent from this number can end after the worktree's screen moved to another (its drafts then are that one's).
  const set = (next: T | undefined | ((prev: T | undefined) => T | undefined)) =>
    setDrafts((d) => {
      if (d && d.at !== at) return d;
      const { [name]: prev, ...rest } = d?.values ?? {};
      const v = typeof next === "function" ? (next as (prev: T | undefined) => T | undefined)(prev as T | undefined) : next;
      // Nothing to write: the drafts stay none, so that they do not become this number's while another one shows.
      if (v === undefined && prev === undefined) return d;
      return { at, values: v === undefined ? rest : { ...rest, [name]: v } };
    });
  return [value, set];
}

/**
 * Drops the drafts of another number of the worktree once its screen shows this one: what is typed for one number shows
 * neither on another nor on it again after another was open (#125).
 */
export function useDraftsOf(machine: string, worktree: WorktreeInfo, where: Where | undefined): void {
  const [, setDrafts] = usePluginState<Drafts | undefined>(draftsKey(machine, worktree), undefined);
  const at = where && draftsAt(where);
  useEffect(() => {
    if (at) setDrafts((d) => (d && d.at !== at ? undefined : d));
  }, [at]);
}

/** Runs the changes of one item's screen; `after` reads the item and the tabs again. `changed` reads everything again. */
export function useChanges(machine: string, where: Where | undefined, after: () => void) {
  const write = useWriteOp();
  const toast = useToast();
  // Kept like the drafts: the screen made anew (another tab chosen and this one again) shows the change still running,
  // and what was sent, still in its box, cannot be sent again meanwhile.
  const [busy, setBusy] = usePluginState<string | undefined>(`busy:${machine}:${where ? `${where.repo}:${draftsAt(where)}` : ""}`, undefined);
  const [revision, setRevision] = useState(0);
  const changed = () => {
    after();
    setRevision((r) => r + 1);
  };
  const run = async (c: Change): Promise<boolean> => {
    if (!where) return false;
    setBusy(c.id);
    const res = await write(machine, c.op, { ...where, ...c.params }, c.summary);
    setBusy(undefined);
    changed();
    if (!res.ok) {
      toast({ title: `「${c.summary}」ができませんでした`, description: res.error, tone: "error" });
      return false;
    }
    const undo = c.undo;
    toast({
      title: c.done,
      ...(undo && {
        undo: async () => {
          const back = await write(machine, undo.op, { ...where, ...undo.params }, `${undo.summary}（取り消し）`);
          changed();
          return back.ok ? undefined : back.error;
        },
      }),
    });
    return true;
  };
  return { busy, revision, run, changed };
}
