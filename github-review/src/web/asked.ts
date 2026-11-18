// What the rows' buttons asked the Agents ("レビューする", "マージしてもらう", "差し戻す", "修正してもらう"), by the pull
// request's URL: kept for the screen, so that the review page and the panel of one pull request both show it is being
// done (verdict.ts underway), and go on showing that, once it ends, until they have read how it went (workRechecking).
// The buttons at work are kept here too, as the page and the panel are drawn side by side.
import { useSyncExternalStore } from "react";
import { ASK_RECHECK_MS, ASK_SETTLE_MS, type Asked, type Recheck, type Underway } from "../verdict.ts";

export interface AskedState {
  asked: ReadonlyMap<string, Asked>;
  rechecks: ReadonlyMap<string, Recheck>;
  /** The pull requests with a button at work, and how many. */
  sending: ReadonlyMap<string, number>;
}

let state: AskedState = { asked: new Map(), rechecks: new Map(), sending: new Map() };
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

/** Has the rows look again once `ms` are over: what they show depends on the time. */
const lookAgainAfter = (ms: number) =>
  setTimeout(() => {
    state = { ...state };
    emit();
  }, ms + 100);

export function markAsked(url: string, entry: Asked): void {
  state = { ...state, asked: new Map(state.asked).set(url, entry) };
  emit();
  // Once the moment is over, the rows look at the sessions alone.
  lookAgainAfter(ASK_SETTLE_MS);
}

/** A button of a pull request is at work, until what this returns is called (once is enough). */
export function holdSending(url: string): () => void {
  const count = (n: number) => {
    const sending = new Map(state.sending);
    if (n > 0) sending.set(url, n);
    else sending.delete(url);
    state = { ...state, sending };
    emit();
  };
  count((state.sending.get(url) ?? 0) + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    count((state.sending.get(url) ?? 1) - 1);
  };
}

/** The rows and the panel of one pull request see its work end at about the same time: that is one end. */
const SAME_END_MS = 1000;

/**
 * What was asked of a pull request is no longer being done: `refresh` reads its lists from GitHub again, as the page
 * would otherwise find out how it went only at its next reading of them.
 */
export function recheck(url: string, of: { kind: Underway; sha: string }, refresh: () => Promise<unknown>): void {
  const now = Date.now();
  const cur = state.rechecks.get(url);
  if (cur && cur.kind === of.kind && cur.sha === of.sha && now - cur.ended < SAME_END_MS) return;
  const entry: Recheck = { ...of, ended: now };
  state = { ...state, rechecks: new Map(state.rechecks).set(url, entry) };
  emit();
  const refreshed = () => {
    if (state.rechecks.get(url) !== entry) return;
    state = { ...state, rechecks: new Map(state.rechecks).set(url, { ...entry, refreshed: Date.now() }) };
    emit();
  };
  void refresh().then(refreshed, refreshed);
  lookAgainAfter(ASK_RECHECK_MS);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** What is kept now. */
export const askedState = (): AskedState => state;

export function useAsked(): AskedState {
  return useSyncExternalStore(subscribe, askedState);
}
