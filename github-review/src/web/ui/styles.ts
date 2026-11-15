// The looks github-review takes from Gasho's screen (as the kanban does), which the SDK does not provide: Gasho's
// dialogs and menus (Radix), and EasyUI's motion tokens (springs).
import type { Transition } from "framer-motion";

/** Gasho's dialogs (components/dialog-styles.ts): a dimmed backdrop and a centred panel that scrolls when too tall. */
export const DIALOG_OVERLAY = "fixed inset-0 z-[90] bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0";
export const DIALOG_PANEL =
  "fixed top-1/2 left-1/2 z-[91] max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95";

/** Gasho's menus (Radix ContextMenu and DropdownMenu). */
export const MENU =
  "z-[100] min-w-52 max-w-[min(18rem,calc(100vw-24px))] rounded-xl border border-border bg-surface p-1.5 text-sm shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95";
export const MENU_ITEM =
  "flex w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 outline-none select-none data-[highlighted]:bg-surface-raised data-[disabled]:pointer-events-none data-[disabled]:opacity-40 [&>svg]:size-4 [&>svg]:shrink-0";

/** EasyUI's motion tokens, as Gasho has them (lib/motion-tokens.ts): soft, physical, never bouncy. */
export const motionTransitions = {
  /** Tabs, fades (~400 ms, no overshoot). */
  springGentle: { type: "spring", stiffness: 170, damping: 26, mass: 0.9 } as Transition,
  /** Cards. */
  springSmooth: { type: "spring", stiffness: 200, damping: 28, mass: 0.85 } as Transition,
  /** Buttons, toasts (~200 ms). */
  springSnappy: { type: "spring", stiffness: 380, damping: 30, mass: 0.5 } as Transition,
  /** Shared layout: the pill of a tab or a switch. */
  springMorph: { type: "spring", stiffness: 220, damping: 32, mass: 1.0 } as Transition,
};
