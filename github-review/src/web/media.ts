// Whether the page has a computer's width (Gasho's sidebar beside the page): the side panel goes beside the list there,
// and a phone opens the pull request's own page instead.
import { useSyncExternalStore } from "react";

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
