// The `fetch` of the board plugins built into this daemon part: kanban/plugins/<name>/index.ts of the checkout that was
// built, as src/web/board-plugins.ts has their `state` for the web part. Not in reader.ts, which the tests run without
// Vite.
import type { BoardFetchers } from "./reader.ts";
import type { Fetch } from "../../plugins/types.ts";

const found = import.meta.glob<unknown>("../../plugins/*/index.ts", { eager: true, import: "fetch" });

export const BOARD_FETCHERS: BoardFetchers = new Map(
  Object.entries(found).flatMap(([file, fetch]): [string, Fetch][] => {
    const name = /\/plugins\/([^/]+)\/index\.ts$/.exec(file)?.[1];
    return name && typeof fetch === "function" ? [[name, fetch as Fetch]] : [];
  }),
);
