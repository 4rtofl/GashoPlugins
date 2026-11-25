// Choosing a suggestion from the keyboard: holding the digit key of its number (1 for the leftmost) for the time of the
// setting holdSeconds (HOLD_MS by default) sends it. The keys are read on the whole page, except where they type into something that already has text: the chat box
// has the focus, and an empty one is where the person waits for the reply. In an empty text box the digit is kept from
// being typed while it is held; let go before that, it is typed then, so that a prompt can start with a digit ("2 で").
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

/** Whether a key press in `target` is for the suggestions, and whether it would type there (an empty text box). */
export function holdTarget(target: EventTarget | null): { take: boolean; types: boolean } {
  if (!(target instanceof HTMLElement)) return { take: true, types: false };
  if (target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && isTextInput(target))) {
    return target.readOnly || target.disabled ? { take: true, types: false } : { take: target.value === "", types: true };
  }
  if (target.isContentEditable) return { take: (target.textContent ?? "") === "", types: true };
  // Other inputs (checkboxes, selects) take no digits; a select does.
  return { take: !(target instanceof HTMLSelectElement), types: false };
}

const TEXT_TYPES = new Set(["text", "search", "url", "tel", "email", "password", "number", ""]);
const isTextInput = (el: HTMLInputElement) => TEXT_TYPES.has(el.type);

/** The suggestion's index for a key press, or undefined when it is not a plain digit key from 1 to `count`. */
export function indexOfKey(e: KeyboardEvent, count: number): number | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.keyCode === 229) return undefined;
  if (!/^[1-9]$/.test(e.key)) return undefined;
  const i = Number(e.key) - 1;
  return i < count ? i : undefined;
}

/** Types `text` where the focus is, as the keyboard would (React's controlled boxes see an input event). */
function typeText(el: HTMLElement, text: string): void {
  if (!el.isConnected || document.activeElement !== el) return;
  // execCommand is the one way to type that a controlled box and its undo history both follow.
  if (document.execCommand?.("insertText", false, text)) return;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    set?.call(el, el.value + text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

interface Held {
  index: number;
  key: string;
  /** The text box the digit would have typed into, to type it after a short press. */
  box?: HTMLElement;
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
    const cancel = (typeShort: boolean) => {
      const h = held.current;
      if (!h) return;
      clearTimeout(h.timer);
      held.current = undefined;
      setHolding(undefined);
      if (typeShort && h.box) typeText(h.box, h.key);
    };
    const onDown = (e: KeyboardEvent) => {
      const h = held.current;
      if (h && e.key === h.key) {
        // The key repeating while it is held.
        e.preventDefault();
        return;
      }
      const index = indexOfKey(e, count);
      if (index === undefined) {
        // Another key while one is held: the person is typing, so the held digit is theirs.
        if (h) cancel(true);
        return;
      }
      // A digit after another: the first is typed, and then the box may no longer be empty.
      if (h) cancel(true);
      const where = holdTarget(e.target);
      if (!where.take) return;
      e.preventDefault();
      const timer = setTimeout(() => {
        held.current = undefined;
        setHolding(undefined);
        latest.current(index);
      }, holdMs);
      held.current = { index, key: e.key, timer, ...(where.types ? { box: e.target as HTMLElement } : {}) };
      setHolding(index);
    };
    const onUp = (e: KeyboardEvent) => {
      if (held.current && e.key === held.current.key) cancel(true);
    };
    // Leaving the window loses the key's release: nothing is typed or sent.
    const onBlur = () => cancel(false);
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", onBlur);
      cancel(false);
    };
  }, [count, enabled, holdMs]);

  return holding;
}
