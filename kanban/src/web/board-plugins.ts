// The board plugins built into this web part: kanban/plugins/<name>/index.ts of the checkout that was built, each
// person's included (they are not in git). Vite puts them in at build time, so building with a plugin changed replaces
// it in a running Gasho like any change of the kanban. Only their `state` is imported: their `fetch` runs in the daemon
// part (src/daemon/board-plugins.ts) and is left out of web.js. Not in src/cards.ts, which the tests run without Vite.
import type { BoardPlugins } from "../cards.ts";

const found = import.meta.glob<unknown>("../../plugins/*/index.ts", { eager: true, import: "state" });

export const BOARD_PLUGINS: BoardPlugins = new Map(
  Object.entries(found)
    .flatMap(([file, state]): [string, { state?: unknown }][] => {
      const name = /\/plugins\/([^/]+)\/index\.ts$/.exec(file)?.[1];
      return name ? [[name, { state }]] : [];
    })
    .sort(([a], [b]) => a.localeCompare(b)),
);
