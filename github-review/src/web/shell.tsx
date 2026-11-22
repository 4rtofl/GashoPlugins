// What the review page and the page of one pull request share around the rows' buttons: the tools they use, the
// templates and the settings of the merge, which rows are at work, and the dialogs and the notice they show; and the
// removal of the review worktrees whose merge or send-back is done, and of the sessions that have posted their review.
// The rows "まとめてレビューさせる" has not done yet are at work too (batch-run.ts).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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

/**
 * A line of questions the rows' work asks, kept here rather than in the page or the panel that asked: the work asks
 * once it has waited (a worktree made, a launch answered), and that part of the screen may be gone by then (the
 * notice's "セッションを開く", a session opened from the sidebar). They wait, in the order they came, until the page or a
 * panel is open, which shows the first (and dialogs.tsx puts it after the questions on screen asked before).
 */
function lineOf<Q, A>() {
  type Asked = Q & { answer: (a: A) => void };
  let line: Asked[] = [];
  const watchers = new Set<() => void>();
  const set = (next: Asked[]) => {
    line = next;
    for (const w of watchers) w();
  };
  const watch = (w: () => void) => {
    watchers.add(w);
    return () => {
      watchers.delete(w);
    };
  };
  return {
    ask: (q: Q) =>
      new Promise<A>((resolve) => {
        const asked: Asked = {
          ...q,
          answer: (a) => {
            // Once: answered twice before the screen draws again, the next one is not answered with it.
            if (!line.includes(asked)) return;
            set(line.filter((x) => x !== asked));
            resolve(a);
          },
        };
        set([...line, asked]);
      }),
    useFirst: () => useSyncExternalStore(watch, () => line[0]),
  };
}

const forks = lineOf<ForkQuestion, boolean>();
const trusts = lineOf<{ path: string; warnings: string[] }, boolean>();
const removals = lineOf<{ item: Item; spot: Spot }, boolean>();
const agentAsks = lineOf<{ kind: CleanupKind; item: Item; spot: Spot }, { cleanup: boolean } | undefined>();

/** Where a part of the screen shows the notices of the rows' work. */
interface NoticeBoard {
  notify: (n: Notice | undefined) => void;
  dismiss: (n: Notice) => void;
}

/**
 * The page and the panels open now, in the order they opened. The last shows the questions, and the notices of the
 * work of one that was left (its own notices show where it is).
 */
let boards: NoticeBoard[] = [];
const boardWatchers = new Set<() => void>();
const setBoards = (next: NoticeBoard[]) => {
  boards = next;
  for (const w of boardWatchers) w();
};
const watchBoards = (w: () => void) => {
  boardWatchers.add(w);
  return () => {
    boardWatchers.delete(w);
  };
};

/** Whether `board` is the last part of the screen opened, which shows the questions, from when it opens till it goes. */
function useShowsQuestions(board: NoticeBoard): boolean {
  useEffect(() => {
    setBoards([...boards, board]);
    return () => setBoards(boards.filter((b) => b !== board));
  }, [board]);
  return useSyncExternalStore(watchBoards, () => boards.at(-1) === board);
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
  const board = useMemo<NoticeBoard>(() => {
    // A notice still going keeps the one with a button it took the place of (directly, or through other notices still
    // going), and that one shows again once it is taken off: another button's session to open stays to open when the
    // person says no to a question.
    const under = new WeakMap<Notice, Notice>();
    return {
      notify: (n) =>
        setNotice((cur) => {
          const back = cur?.busy ? under.get(cur) : cur?.action ? cur : undefined;
          if (n?.busy && back) under.set(n, back);
          return n;
        }),
      dismiss: (n) => setNotice((cur) => (cur === n ? under.get(n) : cur)),
    };
  }, []);
  const shows = useShowsQuestions(board);
  const fork = forks.useFirst();
  const trust = trusts.useFirst();
  const removing = removals.useFirst();
  const asking = agentAsks.useFirst();
  // The work of the rows goes on once this is left, and its notices show where the questions do.
  const left = useRef(false);
  useEffect(() => {
    left.current = false;
    return () => {
      left.current = true;
    };
  }, []);
  // The same while this is drawn again (Gasho's useNavigation is new on every draw, and `tools` with it): the run of
  // "まとめてレビューさせる" shows its notice again whenever the page's `notify` changes, over the rows' own.
  const notices = useMemo(() => {
    const here = (): NoticeBoard | undefined => (left.current ? boards.at(-1) : board);
    // Once this is left, a panel opened since shows the next notice; the last one ("起動しています…", which stays till
    // the next) is taken off where it shows.
    let last: { on: NoticeBoard; n: Notice } | undefined;
    return {
      notify: (n: Notice | undefined) => {
        const on = here();
        if (last && last.on !== on) last.on.dismiss(last.n);
        last = on && n ? { on, n } : undefined;
        on?.notify(n);
      },
      dismiss: (n: Notice) => {
        if (last?.n !== n) return here()?.dismiss(n);
        last.on.dismiss(n);
        last = undefined;
      },
    };
  }, [board]);
  const { sending } = useAsked();
  const batch = useBatchRun();
  const atWork = useMemo(() => new Set([...sending.keys(), ...batchBusy(batch)]), [sending, batch]);

  const tools = useMemo<Tools>(() => {
    const actions: Actions = {
      notify: notices.notify,
      dismiss: notices.dismiss,
      askFork: forks.ask,
      askTrust: trusts.ask,
      askRemove: removals.ask,
      askAgentFor: agentAsks.ask,
      reload: (id) => sources[id]?.reload(),
      refresh: async (id) => sources[id]?.refresh(),
    };
    return { call, launch, send, remove, removeSession, nav, actions };
  }, [call, launch, send, remove, removeSession, nav, sources, notices]);
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
      // Held till the work ends: its questions wait for the page or a panel to be open again.
      const release = holdSending(url);
      void work()
        .catch((e: unknown) => tools.actions.notify({ text: e instanceof Error ? e.message : String(e), tone: "danger" }))
        .finally(release);
    },
  };

  const overlays = (
    <>
      <ForkDialog question={shows ? fork : undefined} onAnswer={(a) => fork?.answer(a)} />
      <TrustDialog question={shows ? trust : undefined} onAnswer={(a) => trust?.answer(a)} />
      <RemoveDialog question={shows ? removing : undefined} onAnswer={(a) => removing?.answer(a)} />
      <AskDialog question={shows ? asking : undefined} merge={merge} onAnswer={(a) => asking?.answer(a)} />
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
