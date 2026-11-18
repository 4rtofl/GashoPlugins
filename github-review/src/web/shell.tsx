// What the review page and the page of one pull request share around the rows' buttons: the tools they use, the
// templates and the settings of the merge, which rows are at work, and the dialogs and the notice they show; and the
// removal of the review worktrees whose merge or send-back is done, and of the sessions that have posted their review.
// The rows "まとめてレビューさせる" has not done yet are at work too (batch-run.ts).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCall, useLaunchSession, useNavigation, useRemoveSession, useRemoveWorktree, removeWorktreeProblem, useSendInput, useSetting, type MachineInfo } from "@gasho/plugin-sdk";
import type { CleanupKind } from "../cleanup.ts";
import { mergeMethodOf } from "../instructions.ts";
import { atRest } from "../review-session.ts";
import { parseTemplates } from "../template.ts";
import type { Place } from "../types.ts";
import { working } from "../verdict.ts";
import { cleanUp, removeFinishedSession, type Actions, type ForkQuestion, type Item, type Notice, type Spot, type Tools } from "./actions";
import { holdSending, useAsked } from "./asked";
import { batchBusy, useBatchRun } from "./batch-run";
import { AskDialog, ForkDialog, RemoveDialog, Toast, TrustDialog } from "./dialogs";
import type { Source } from "./listing";
import type { RowShared } from "./row";

type Question<Q, A = boolean> = (Q & { answer: (a: A) => void }) | undefined;

/**
 * Questions that come once a row's work has waited (a worktree made, a launch answered), so another row's may come
 * while one is shown: they wait, and show one at a time in the order they came (and after those of the other parts of
 * the screen asked before: dialogs.tsx). The first one and how to answer it.
 */
function useQuestions<Q, A = boolean>(): [Question<Q, A>, (q: Q) => Promise<A>, (a: A) => void] {
  const [queue, setQueue] = useState<NonNullable<Question<Q, A>>[]>([]);
  const ask = useCallback((q: Q) => new Promise<A>((resolve) => setQueue((cur) => [...cur, { ...q, answer: resolve }])), []);
  const shown = queue[0];
  const reply = (a: A) => {
    if (!shown) return;
    shown.answer(a);
    // Removed as itself, not as the first: answered twice before the page draws again, the next one is not dropped unanswered.
    setQueue((cur) => cur.filter((q) => q !== shown));
  };
  return [shown, ask, reply];
}

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
  const removeSession = useRemoveSession();
  const [rawTemplates] = useSetting<string>("templates");
  const templates = useMemo(() => parseTemplates(rawTemplates), [rawTemplates]);
  const [rawMethod] = useSetting<string>("mergeMethod");
  const [rawDelete] = useSetting<boolean>("deleteBranch");
  const merge = useMemo(() => ({ method: mergeMethodOf(rawMethod), deleteBranch: rawDelete !== false }), [rawMethod, rawDelete]);
  const [notice, setNotice] = useState<Notice>();
  const [fork, askFork, answerFork] = useQuestions<ForkQuestion>();
  const [trust, askTrust, answerTrust] = useQuestions<{ path: string; warnings: string[] }>();
  const [removing, setRemoving] = useState<Question<{ item: Item; spot: Spot }>>();
  const [asking, setAsking] = useState<Question<{ kind: CleanupKind; item: Item; spot: Spot }, { cleanup: boolean } | undefined>>();
  const { sending } = useAsked();
  // What this page's buttons hold. A dialog of a page that was left is never answered: its button is not held after that.
  const held = useRef(new Set<() => void>());
  useEffect(
    () => () => {
      for (const release of held.current) release();
      held.current.clear();
    },
    [],
  );
  const batch = useBatchRun();
  const atWork = useMemo(() => new Set([...sending.keys(), ...batchBusy(batch)]), [sending, batch]);

  const tools = useMemo<Tools>(() => {
    const actions: Actions = {
      notify: setNotice,
      dismiss: (n) => setNotice((cur) => (cur === n ? undefined : cur)),
      askFork,
      askTrust,
      askRemove: (q) => new Promise<boolean>((resolve) => setRemoving({ ...q, answer: resolve })),
      askAgentFor: (q) => new Promise<{ cleanup: boolean } | undefined>((resolve) => setAsking({ ...q, answer: resolve })),
      reload: (id) => sources[id]?.reload(),
      refresh: async (id) => sources[id]?.refresh(),
    };
    return { call, launch, send, remove, removeSession, nav, actions };
  }, [call, launch, send, remove, removeSession, nav, sources, askFork, askTrust]);
  useAutoCleanup(sources, ready, tools);
  useFinishedSessions(sources, ready, tools);

  const shared: RowShared = {
    tools,
    templates,
    busy: atWork,
    machines: ready.length > 1,
    merge,
    listedAt: (machines) => {
      const times = machines.map((id) => sources[id]?.at);
      return times.every((t) => t !== undefined) && times.length > 0 ? Math.min(...(times as number[])) : undefined;
    },
    ...(select ? { select } : {}),
    ...(selected ? { selected } : {}),
    run: (url, work) => {
      const release = holdSending(url);
      held.current.add(release);
      void work()
        .catch((e: unknown) => setNotice({ text: e instanceof Error ? e.message : String(e), tone: "danger" }))
        .finally(() => {
          held.current.delete(release);
          release();
        });
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
      <ForkDialog question={fork} onAnswer={answerFork} />
      <TrustDialog question={trust} onAnswer={answerTrust} />
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

/**
 * Removes the sessions that have posted the review sent to them, once they are at rest, on every working server the page
 * lists. One that is gone already is forgotten. Each is tried once by this page.
 */
function useFinishedSessions(sources: Record<string, Source>, ready: MachineInfo[], tools: Tools): void {
  const tried = useRef(new Set<string>());
  useEffect(() => {
    for (const machine of ready) {
      const listing = sources[machine.id]?.listing;
      if (!listing) continue;
      for (const pr of [...listing.requested, ...listing.repos.flatMap((r) => r.prs)]) {
        for (const sessionId of pr.place?.finishedSessions ?? []) {
          const session = machine.sessions.find((s) => s.sessionId === sessionId);
          const key = `${machine.id} ${sessionId}`;
          if ((session && !atRest(session)) || tried.current.has(key)) continue;
          tried.current.add(key);
          const work = session
            ? removeFinishedSession(pr, machine, sessionId, tools)
            : tools.call({ machine: machine.id, method: "reviewSession", params: { action: "forget", sessionId }, summary: "無くなったレビューのセッションを忘れる" });
          void work.catch((e: unknown) => tools.actions.notify({ text: e instanceof Error ? e.message : String(e), tone: "danger" }));
        }
      }
    }
  }, [sources, ready, tools]);
}

/** A worktree whose merge or send-back is done, with no session at work in it: the page removes it now. */
function readyToClean(machine: MachineInfo, place: Place): boolean {
  const { worktree, cleanup } = place;
  if (!worktree || !cleanup?.done || cleanup.problem) return false;
  return !working(machine.sessions, worktree.path) && removeWorktreeProblem(machine, { path: worktree.path, repo: place.primary }) === undefined;
}
