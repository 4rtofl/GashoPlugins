// What the rows' buttons asked the Agents ("マージしてもらう", "差し戻す", "修正してもらう"), by the pull request's URL:
// kept for the screen, so that the review page and the panel of one pull request both show it is being done
// (verdict.ts askRunning).
import { useSyncExternalStore } from "react";
import { ASK_SETTLE_MS, type Asked } from "../verdict.ts";

let asked: ReadonlyMap<string, Asked> = new Map();
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export function markAsked(url: string, entry: Asked): void {
  asked = new Map(asked).set(url, entry);
  emit();
  // Once the moment is over, the rows look at the sessions alone.
  setTimeout(() => {
    asked = new Map(asked);
    emit();
  }, ASK_SETTLE_MS + 100);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useAsked(): ReadonlyMap<string, Asked> {
  return useSyncExternalStore(subscribe, () => asked);
}
