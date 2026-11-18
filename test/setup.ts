import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { reset } from "./sdk.tsx";

// happy-dom's Element.animate rejects an animation's `finished` when it is cancelled, and framer-motion (the cards of
// kanban, the toasts of github-implement) leaves that unhandled, which fails the run. Without it, framer-motion animates
// with its own timers.
delete (Element.prototype as { animate?: unknown }).animate;

afterEach(() => {
  cleanup();
  reset();
});
