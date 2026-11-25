// Removing the worktrees of merged pull requests, with the sessions in them and their local branches, once nobody has
// used them for "removeMergedMinutes" (0, the default, turns it off): what the merged section's button does, without
// asking and never forced, so that uncommitted changes or commits that were not pushed keep a worktree, with the reason
// in its merged section. It runs from the worktree's tab row (tabs.ts), so while a page shows a session or a worktree:
// one round every ROUND_MS per page, over every working server the page lists. The daemon part says which worktrees are
// merged (the operation "merged") and lets one page at a time remove each (the operation "auto-remove").
import { useEffect, useRef } from "react";
import { removeWorktreeProblem, useCall, useMachines, useRemoveWorktree, useSetting, type MachineInfo } from "@gasho/plugin-sdk";
import type { MergedWorktree } from "../types.ts";
import { changesText, dueForRemoval, sessionsIn, trimSlash } from "./item/cleanup.ts";

const ROUND_MS = 60_000;
/** The first round waits for the page to have read what it shows. */
const FIRST_MS = 10_000;

interface Row {
  machines: MachineInfo[];
  call: ReturnType<typeof useCall>;
  remove: ReturnType<typeof useRemoveWorktree>;
  minutes: number;
  /** The worktree the row is of: in use while the page shows it. */
  machine: string;
  path: string;
}

/** The page's tab rows while it is on, the last drawn last: a round uses what they have when it gets to each step. */
const rows = new Set<{ current: Row }>();
let timer: ReturnType<typeof setTimeout> | undefined;
let going = false;

const latest = (): Row | undefined => [...rows].at(-1)?.current;
const shownOn = (machine: string): string[] => [...rows].flatMap(({ current: r }) => (r.machine === machine ? [r.path] : []));

function schedule(ms: number): void {
  timer = setTimeout(() => {
    timer = undefined;
    going = true;
    void round()
      .catch(() => undefined)
      .finally(() => {
        going = false;
        if (rows.size > 0 && !timer) schedule(ROUND_MS);
      });
  }, ms);
}

async function round(): Promise<void> {
  for (const { id } of latest()?.machines ?? []) {
    const row = latest();
    const machine = row?.machines.find((m) => m.id === id);
    if (!row || !machine?.connected || !machine.canRemoveWorktree) continue;
    const r = await row.call<{ now: number; worktrees: MergedWorktree[] }>({ machine: id, method: "read", params: { op: "merged", shown: shownOn(id) } });
    if (!r.ok) continue;
    for (const w of r.data.worktrees) await removeIfDue(id, w, r.data.now);
  }
}

/** `now`: the working server's clock when it listed `w`, as the times of its sessions are. */
async function removeIfDue(id: string, w: MergedWorktree, now: number): Promise<void> {
  const row = latest();
  const machine = row?.machines.find((m) => m.id === id);
  if (!row || !machine || shownOn(id).some((p) => trimSlash(p) === trimSlash(w.path))) return;
  if (!dueForRemoval(w, sessionsIn(machine, w.path), row.minutes, now)) return;
  if (removeWorktreeProblem(machine, { path: w.path, repo: w.repoDir }) !== undefined) return;
  const tell = <T>(params: Record<string, unknown>, summary: string) => row.call<T>({ machine: id, method: "write", params: { op: "auto-remove", worktree: w.path, ...params }, summary });
  const name = `マージ済みの ${w.repo}#${w.number} の worktree（${w.path}）`;
  const claim = await tell<{ claimed: boolean }>({ action: "claim" }, `${name}を、自動で削除し始める`);
  if (!claim.ok || !claim.data.claimed) return;
  const res = await row.remove({ machine: id, path: w.path, branch: w.branch, pushed: [w.head] });
  if (res.ok) await tell({ action: "removed" }, `${name}を、自動で削除した`);
  else await tell({ action: "failed", problem: res.changes ? changesText(res.changes) : res.error }, `${name}を、自動では削除しなかった`);
}

/** Takes part in the rounds while "removeMergedMinutes" is over 0: from the tab row of the worktree at `path`. */
export function useAutoRemove(machine: string, path: string): void {
  const [minutes] = useSetting<number>("removeMergedMinutes");
  const now: Row = { machines: useMachines(), call: useCall(), remove: useRemoveWorktree(), minutes: typeof minutes === "number" ? minutes : 0, machine, path };
  const row = useRef(now);
  useEffect(() => {
    row.current = now;
  });
  const on = now.minutes > 0;
  useEffect(() => {
    if (!on) return;
    rows.add(row);
    if (!timer && !going) schedule(FIRST_MS);
    return () => {
      rows.delete(row);
      if (rows.size > 0 || !timer) return;
      clearTimeout(timer);
      timer = undefined;
    };
  }, [on]);
}
