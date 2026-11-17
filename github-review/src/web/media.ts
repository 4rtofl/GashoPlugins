// Whether the page has a computer's width (Gasho's sidebar beside the page): the side panel goes beside the list there,
// as wide as Gasho's side panel of a session, and a phone opens the pull request's own page instead.
import { useLayoutEffect, useState, useSyncExternalStore } from "react";

export const DESKTOP = "(min-width: 768px)";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (l) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", l);
      return () => list.removeEventListener("change", l);
    },
    () => window.matchMedia(query).matches,
  );
}

/** Gasho's side panel of a session (lib/widths.ts): 40% of the window, within this range. */
const PANEL_MIN = 380;
const PANEL_MAX = 620;
/** What the panel leaves the list beside it, at least. */
const LIST_MIN = 140;

/** The panel's width as Gasho's: 40% of the window, made narrower when the row (`room`) leaves the list too little. */
export function panelWidth(windowWidth: number, room: number): number {
  return Math.max(PANEL_MIN, Math.min(PANEL_MAX, room - LIST_MIN, Math.round(windowWidth * 0.4)));
}

/** The width of the side panel beside the list in the row `ref` points to, followed as the window and the sidebar change. */
export function usePanelWidth(): { ref: (el: HTMLElement | null) => void; width: number } {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [room, setRoom] = useState(Number.POSITIVE_INFINITY);
  const [win, setWin] = useState(() => window.innerWidth);
  useLayoutEffect(() => {
    const onResize = () => setWin(window.innerWidth);
    window.addEventListener("resize", onResize);
    if (!el) return () => window.removeEventListener("resize", onResize);
    const observer = new ResizeObserver(() => setRoom(el.clientWidth));
    observer.observe(el);
    setRoom(el.clientWidth);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [el]);
  return { ref: setEl, width: panelWidth(win, room) };
}
