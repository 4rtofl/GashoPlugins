// What every part of one item's screen shares (useItem): the item as last read, where it is, the clock, and running a
// change. A change is one operation of the daemon part; when it is done, a toast says so (an Undo Toast when it can be
// put back), and the item, the worktree's tabs and what the parts read themselves (useAfterChange) are read again.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { WorktreeInfo } from "@gasho/plugin-sdk";
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
  /** The worktree whose tab shows the item. */
  worktree: WorktreeInfo;
  where: Where;
  item: GitHubItemDetail;
  now: number;
  /** The id of the change that runs, if one does. One runs at a time. */
  busy?: string;
  run(change: Change): Promise<boolean>;
  /** Grows after every change. */
  revision: number;
}

const ItemContext = createContext<ItemScope | undefined>(undefined);

export const ItemProvider = ItemContext.Provider;

export function useItem(): ItemScope {
  const scope = useContext(ItemContext);
  if (!scope) throw new Error("useItem is for the parts of an item's screen");
  return scope;
}

/** Calls `reload` after every change made on the screen, for what a part reads itself. */
export function useAfterChange(reload: () => void): void {
  const { revision } = useItem();
  const first = useRef(revision);
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    if (revision !== first.current) latest.current();
  }, [revision]);
}

/** Runs the changes of one item's screen; `after` reads the item and the tabs again. */
export function useChanges(machine: string, where: Where | undefined, after: () => void) {
  const write = useWriteOp();
  const toast = useToast();
  const [busy, setBusy] = useState<string>();
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
  return { busy, revision, run };
}
