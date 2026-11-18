// What the review page and the page of one pull request share around the rows' buttons: the tools they use, the
// templates and the settings of the merge, which rows are at work, and the dialogs and the notice they show; and the
// removal of the review worktrees whose merge or send-back is done.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCall, useLaunchSession, useNavigation, useRemoveWorktree, removeWorktreeProblem, useSendInput, useSetting, type MachineInfo } from "@gasho/plugin-sdk";
import type { CleanupKind } from "../cleanup.ts";
import { mergeMethodOf } from "../instructions.ts";
import { parseTemplates } from "../template.ts";
import type { Place } from "../types.ts";
import { working } from "../verdict.ts";
import { cleanUp, type Actions, type Item, type Notice, type Spot, type Tools } from "./actions";
import { AskDialog, RemoveDialog, Toast, TrustDialog } from "./dialogs";
import type { Source } from "./listing";
import type { RowShared } from "./row";

type Question<Q, A = boolean> = (Q & { answer: (a: A) => void }) | undefined;

export function useRowShell({
  sources,
  ready,
  select,
  selected,
}: {
  sources: Record<string, Source>;
  ready: MachineInfo[];
  select?: (item: Item) => void;
  selected?: string;
}): { shared: RowShared; overlays: ReactNode } {
  const nav = useNavigation();
  const call = useCall();
  const launch = useLaunchSession();
  const send = useSendInput();
  const remove = useRemoveWorktree();
  const [rawTemplates] = useSetting<string>("templates");
  const templates = useMemo(() => parseTemplates(rawTemplates), [rawTemplates]);
  const [rawMethod] = useSetting<string>("mergeMethod");
  const [rawDelete] = useSetting<boolean>("deleteBranch");
  const merge = useMemo(() => ({ method: mergeMethodOf(rawMethod), deleteBranch: rawDelete !== false }), [rawMethod, rawDelete]);
  const [notice, setNotice] = useState<Notice>();
  const [trust, setTrust] = useState<Question<{ path: string; warnings: string[] }>>();
  const [removing, setRemoving] = useState<Question<{ item: Item; spot: Spot }>>();
  const [asking, setAsking] = useState<Question<{ kind: CleanupKind; item: Item; spot: Spot }, { cleanup: boolean } | undefined>>();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  const tools = useMemo<Tools>(() => {
    const actions: Actions = {
      notify: setNotice,
      askTrust: (q) => new Promise<boolean>((resolve) => setTrust({ ...q, answer: resolve })),
      askRemove: (q) => new Promise<boolean>((resolve) => setRemoving({ ...q, answer: resolve })),
      askAgentFor: (q) => new Promise<{ cleanup: boolean } | undefined>((resolve) => setAsking({ ...q, answer: resolve })),
      reload: (id) => sources[id]?.reload(),
      refresh: async (id) => sources[id]?.refresh(),
    };
    return { call, launch, send, remove, nav, actions };
  }, [call, launch, send, remove, nav, sources]);
  useAutoCleanup(sources, ready, tools);

  const shared: RowShared = {
    tools,
    templates,
    busy,
    machines: ready.length > 1,
    merge,
    listedAt: (machines) => {
      const times = machines.map((id) => sources[id]?.at);
      return times.every((t) => t !== undefined) && times.length > 0 ? Math.min(...(times as number[])) : undefined;
    },
    ...(select ? { select } : {}),
    ...(selected ? { selected } : {}),
    run: (url, work) => {
      setBusy((cur) => new Set(cur).add(url));
      void work()
        .catch((e: unknown) => setNotice({ text: e instanceof Error ? e.message : String(e), tone: "danger" }))
        .finally(() =>
          setBusy((cur) => {
            const next = new Set(cur);
            next.delete(url);
            return next;
          }),
        );
    },
  };

  const answer =
    <Q, A>(q: Question<Q, A>, clear: () => void) =>
    (a: A) => {
      q?.answer(a);
      clear();
    };
  const overlays = (
    <>
      <TrustDialog question={trust} onAnswer={answer(trust, () => setTrust(undefined))} />
      <RemoveDialog question={removing} onAnswer={answer(removing, () => setRemoving(undefined))} />
      <AskDialog question={asking} merge={merge} onAnswer={answer(asking, () => setAsking(undefined))} />
      <Toast notice={notice} onClose={() => setNotice(undefined)} />
    </>
  );
  return { shared, overlays };
}

/**
 * Removes the review worktrees whose merge or send-back, asked with "終わったら片付ける", is done, once no session in
 * them is at work (cleanup.ts), on every working server the page lists. Each is tried once by this page; the daemon
 * part lets one page at a time remove it.
 */
function useAutoCleanup(sources: Record<string, Source>, ready: MachineInfo[], tools: Tools): void {
  const tried = useRef(new Set<string>());
  useEffect(() => {
    for (const machine of ready) {
      const listing = sources[machine.id]?.listing;
      if (!listing) continue;
      for (const pr of [...listing.requested, ...listing.repos.flatMap((r) => r.prs)]) {
        const place = pr.place;
        if (!place || !readyToClean(machine, place)) continue;
        const key = `${machine.id} ${pr.url} ${place.worktree?.path}`;
        if (tried.current.has(key)) continue;
        tried.current.add(key);
        void cleanUp(pr, machine, place, tools).catch((e: unknown) => tools.actions.notify({ text: e instanceof Error ? e.message : String(e), tone: "danger" }));
      }
    }
  }, [sources, ready, tools]);
}

/** A review worktree whose merge or send-back is done, with no session at work in it: the page removes it now. */
function readyToClean(machine: MachineInfo, place: Place): boolean {
  const { worktree, cleanup } = place;
  if (!worktree?.review || !cleanup?.done || cleanup.problem) return false;
  return !working(machine.sessions, worktree.path) && removeWorktreeProblem(machine, { path: worktree.path, repo: place.primary }) === undefined;
}
