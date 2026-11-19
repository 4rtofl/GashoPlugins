// The text boxes of github-implement (a title, a body, a comment), on Gasho's tokens, the keys typed into them, and
// what stays typed in them.
import { useEffect, type KeyboardEvent as ReactKeyboardEvent } from "react";

export const INPUT = "w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40";

/**
 * A key that belongs to the composition of Japanese text (an input method): Chrome sends it with isComposing, and
 * Safari sends the Enter that ends a composition after it ended, with keyCode 229 only.
 */
export function isComposing(e: ReactKeyboardEvent | KeyboardEvent): boolean {
  const key = "nativeEvent" in e ? e.nativeEvent : e;
  return key.isComposing || key.keyCode === 229;
}

/** For a checkbox in a form: Enter on it would submit the form (Chrome), and does nothing instead. Space checks it. */
export function noSubmit(e: ReactKeyboardEvent): void {
  if (e.key === "Enter") e.preventDefault();
}

/** Gasho draws the plugin's parts and its popups inside an element with the plugin's id (gasho-plugin.json). */
const PLUGIN = '[data-gasho-plugin="github-implement"]';

/** Whether an Esc that cancelled a composition is going round now: the palette's dialog does not close on it. */
let composingEscape = false;
export const isComposingEscape = (): boolean => composingEscape;

/**
 * Keeps an Esc that cancels a composition in a box of the plugin from closing what the box is in. Gasho's Popover
 * (Radix) closes on every Esc that reaches the document, so the key stops on the window, which it reaches first.
 */
export function useComposingEscape(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !isComposing(e) || !(e.target instanceof Element) || !e.target.closest(PLUGIN)) return;
      e.stopPropagation();
      composingEscape = true;
      // A dialog's cancel comes after the key, in the same task.
      setTimeout(() => (composingEscape = false));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

/** What is left in a box once `sent` went to GitHub: what was typed after it while it was being sent. */
export function leftAfter(now: string, sent: string): string {
  if (now === sent) return "";
  return now.startsWith(sent) ? now.slice(sent.length).trimStart() : now;
}

/** What is typed on the screen of a worktree, by name, and the issue or pull request it is typed for ("issues#17"). */
export interface Drafts {
  at: string;
  values: Record<string, unknown>;
}

/**
 * The drafts once the screen of `at` sets the draft `name` to `next`. A change sent from one number can end after the
 * worktree's screen moved to another: the drafts of that one stay, and none are made for `at` when nothing is written.
 */
export function withDraft<T>(d: Drafts | undefined, at: string, name: string, next: T | undefined | ((prev: T | undefined) => T | undefined)): Drafts | undefined {
  if (d && d.at !== at) return d;
  const { [name]: prev, ...rest } = d?.values ?? {};
  const v = typeof next === "function" ? (next as (prev: T | undefined) => T | undefined)(prev as T | undefined) : next;
  if (v === undefined && prev === undefined) return d;
  return { at, values: v === undefined ? rest : { ...rest, [name]: v } };
}
