// EasyUI's motion tokens, as Gasho has them (lib/motion-tokens.ts): soft, physical, never bouncy.
import type { Transition } from "framer-motion";

export const motionTransitions = {
  /** Tabs, fades (~400 ms, no overshoot). */
  springGentle: { type: "spring", stiffness: 170, damping: 26, mass: 0.9 } as Transition,
  /** Buttons, toasts (~200 ms). */
  springSnappy: { type: "spring", stiffness: 380, damping: 30, mass: 0.5 } as Transition,
  /** Shared layout: the pill of a tab. */
  springMorph: { type: "spring", stiffness: 220, damping: 32, mass: 1.0 } as Transition,
};

/** Fast at first, then settling. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
