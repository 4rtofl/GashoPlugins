// The board plugins built into this web part: kanban/plugins/<name>/index.ts of the checkout that was built, each
// person's included (they are not in git). Vite puts them in at build time, so building with a plugin changed replaces
// it in a running Gasho like any change of the kanban. Not in src/cards.ts, which the tests run without Vite.
import type { BoardPlugins } from "../cards.ts";

const found = import.meta.glob<{ state?: unknown; headings?: unknown }>("../../plugins/*/index.ts", { eager: true });

export const BOARD_PLUGINS: BoardPlugins = new Map(
  Object.entries(found)
    .flatMap(([file, mod]): [string, { state?: unknown; headings?: unknown }][] => {
      const name = /\/plugins\/([^/]+)\/index\.ts$/.exec(file)?.[1];
      return name ? [[name, mod]] : [];
    })
    .sort(([a], [b]) => a.localeCompare(b)),
);
