// "まとめてレビューさせる" while it runs, kept here, outside the review page. Gasho draws the page only while it is open:
// a session opened from the dialog or the sidebar, or on a phone a pull request's panel, takes its place. The run goes on
// meanwhile, as what it does (the daemon part's calls, starting sessions, sending) does not need the page. A folder that
// Claude Code asks about waits for the review page to ask the person; when the page is back, it shows the run's dialog,
// the rows it has not done yet and its notice from here.
import { useEffect, useSyncExternalStore } from "react";
import type { MachineInfo } from "@gasho/plugin-sdk";
import type { Template } from "../template.ts";
import { batchSummary, reviewAll, type Actions, type BatchStep, type Item, type Notice, type Spot, type Tools } from "./actions.ts";

/** A pull request "まとめてレビューさせる" would do, and where. */
export interface BatchTarget {
  item: Item;
  spot: Spot;
}

/** What the person chose from the menu: where, what to send, and the pull requests it would do. */
export interface BatchChoice {
  machine: MachineInfo;
  template: Template;
  targets: BatchTarget[];
}

/** A run of "まとめてレビューさせる" (`targets`: those the person kept ticked). The last one stays till another starts. */
export interface BatchRun extends BatchChoice {
  /** How each pull request is going, by its URL. */
  steps: Record<string, BatchStep>;
  running: boolean;
  /** Its dialog is open. */
  shown: boolean;
  /** A folder Claude Code asks about: the review page asks the person, and the run waits while the page is away. */
  trust?: { path: string; warnings: string[]; answer: (yes: boolean) => void };
}

let current: BatchRun | undefined;
/** Counts the runs, so that one replaced never changes the next. */
let generation = 0;
const listeners = new Set<() => void>();

function set(run: BatchRun | undefined): void {
  current = run;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The run, as it is now. */
export const batchRun = (): BatchRun | undefined => current;

export function useBatchRun(): BatchRun | undefined {
  return useSyncExternalStore(subscribe, batchRun);
}

/** The pull requests the run has not done yet: their rows' buttons stay off. */
export function batchBusy(run: BatchRun | undefined): string[] {
  if (!run?.running) return [];
  return Object.entries(run.steps).flatMap(([url, step]) => (step.state === "waiting" || step.state === "working" ? [url] : []));
}

/** The notice of the review page open now, if one is. */
let page: ((n: Notice | undefined) => void) | undefined;
/** The run's last notice, and whether a page showed it. */
let notice: { n: Notice | undefined; seen: boolean } = { n: undefined, seen: true };

function tell(n: Notice | undefined): void {
  notice = { n, seen: page !== undefined };
  page?.(n);
}

/**
 * The review page shows the run's notices while it is open: when it comes back, how far the run is, or how it went
 * (once) if it ended while the page was away. Returns what to call when the page goes.
 */
export function attachBatchPage(notify: (n: Notice | undefined) => void): () => void {
  page = notify;
  if (current?.running || !notice.seen) {
    notify(notice.n);
    notice = { ...notice, seen: true };
  }
  return () => {
    if (page === notify) page = undefined;
  };
}

export function useBatchPage(notify: (n: Notice | undefined) => void): void {
  useEffect(() => attachBatchPage(notify), [notify]);
}

/**
 * Starts "まとめてレビューさせる" for `targets`, with the tools of the review page that starts it (the daemon part's calls,
 * starting sessions, sending and reading the lists again go on without the page); its dialog shows. Nothing when one
 * is running.
 */
export function startBatch(choice: BatchChoice, targets: BatchTarget[], tools: Tools): void {
  if (current?.running) return;
  const id = ++generation;
  const update = (f: (run: BatchRun) => BatchRun) => {
    if (id === generation && current) set(f(current));
  };
  set({ ...choice, targets, steps: Object.fromEntries(targets.map((x) => [x.item.pr.url, { state: "waiting" }])), running: true, shown: true });
  const actions: Actions = {
    ...tools.actions,
    notify: tell,
    dismiss: (n) => {
      if (notice.n === n) tell(undefined);
    },
    askTrust: (q) =>
      new Promise<boolean>((resolve) =>
        update((run) => ({
          ...run,
          trust: {
            ...q,
            answer: (yes) => {
              update((cur) => ({ ...cur, trust: undefined }));
              resolve(yes);
            },
          },
        })),
      ),
  };
  void reviewAll(targets, choice.template, { ...tools, actions }, (url, step) => update((run) => ({ ...run, steps: { ...run.steps, [url]: step } })))
    .then((count) => tell({ ...batchSummary(count, targets.length), action: { label: "結果を見る", run: showBatch } }))
    .catch((e: unknown) => tell({ text: e instanceof Error ? e.message : String(e), tone: "danger" }))
    .finally(() => update((run) => ({ ...run, running: false, trust: undefined })));
}

/** Opens the run's dialog again. */
export function showBatch(): void {
  if (current) set({ ...current, shown: true });
}

/** Closes the run's dialog: the run goes on, or stays as it ended for "結果を見る". */
export function hideBatch(): void {
  if (current) set({ ...current, shown: false });
}
