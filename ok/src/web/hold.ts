// Choosing a suggestion from the keyboard: holding the digit key of its number (1 for the leftmost) for the time of the
// setting holdSeconds (HOLD_MS by default) sends it. The keys are read on the whole page, except while the focus is
// where text is typed, such as the chat box: there the digits are typed as usual.
import { useEffect, useRef, useState } from "react";

export const HOLD_MS = 2500;
/** The range of the setting holdSeconds (gasho-plugin.json). */
export const HOLD_MIN_MS = 500;
export const HOLD_MAX_MS = 10_000;

/** The time to hold a key for, from the setting holdSeconds: HOLD_MS when it is not a number, else within its range. */
export function holdMsOf(seconds: unknown): number {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return HOLD_MS;
  return Math.min(HOLD_MAX_MS, Math.max(HOLD_MIN_MS, Math.round(seconds * 1000)));
}

/**
 * Whether `target` is where text is typed: a text box (the chat box among them), an editable element or a select.
 * Keys pressed there are the person's, and never choose a suggestion.
 */
export function typesText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return TEXT_TYPES.has(target.type);
  return target.isContentEditable;
}

const TEXT_TYPES = new Set(["text", "search", "url", "tel", "email", "password", "number", ""]);

/** The suggestion's index for a key press, or undefined when it is not a plain digit key from 1 to `count`. */
export function indexOfKey(e: KeyboardEvent, count: number): number | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.keyCode === 229) return undefined;
  if (!/^[1-9]$/.test(e.key)) return undefined;
  const i = Number(e.key) - 1;
  return i < count ? i : undefined;
}

interface Held {
  index: number;
  key: string;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * The index of the suggestion whose key is held (undefined: none). `onHold` is called with it once the key has been
 * held for `holdMs`. Off while `enabled` is false (no suggestions, or one is being sent).
 */
export function useHoldKeys(count: number, enabled: boolean, holdMs: number, onHold: (index: number) => void): number | undefined {
  const [holding, setHolding] = useState<number | undefined>();
  const held = useRef<Held | undefined>(undefined);
  const latest = useRef(onHold);
  latest.current = onHold;

  useEffect(() => {
    if (!enabled || count === 0) return;
    const cancel = () => {
      const h = held.current;
      if (!h) return;
      clearTimeout(h.timer);
      held.current = undefined;
      setHolding(undefined);
    };
    const onDown = (e: KeyboardEvent) => {
      const h = held.current;
      if (h && e.key === h.key) {
        // The key repeating while it is held.
        e.preventDefault();
        return;
      }
      // Another key while one is held: the hold is over.
      if (h) cancel();
      const index = indexOfKey(e, count);
      if (index === undefined || typesText(e.target)) return;
      e.preventDefault();
      const timer = setTimeout(() => {
        held.current = undefined;
        setHolding(undefined);
        latest.current(index);
      }, holdMs);
      held.current = { index, key: e.key, timer };
      setHolding(index);
    };
    const onUp = (e: KeyboardEvent) => {
      if (held.current && e.key === held.current.key) cancel();
    };
    // The focus going to a text box (a click in the chat box) or leaving the window ends the hold: nothing is sent.
    const onFocus = (e: FocusEvent) => {
      if (typesText(e.target)) cancel();
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("focusin", onFocus);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("focusin", onFocus);
      window.removeEventListener("blur", cancel);
      cancel();
    };
  }, [count, enabled, holdMs]);

  return holding;
}
