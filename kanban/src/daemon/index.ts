// The daemon part of the kanban plugin: on each working server, the repositories that can be watched (from the folders
// Gasho can start sessions in), and the worktrees and my pull requests of the watched ones, read with git and gh, with
// what their board plugins' `fetch` gives. The web part asks for the board every minute while it shows; there are no
// events (P8) yet.
import path from "node:path";
import { defineDaemonPlugin, PluginError } from "@gasho/plugin-sdk/daemon";
import { BOARD_FETCHERS } from "./board-plugins.ts";
import { Reader } from "./reader.ts";

let reader: Reader | undefined;

function current(): Reader {
  if (!reader) throw new PluginError("カンバンの daemon の部分が、まだ動き始めていません。");
  return reader;
}

export default defineDaemonPlugin({
  start(ctx) {
    reader = new Reader({
      exec: ctx.exec,
      github: (args, o) => ctx.github.read(args, o),
      fetchers: BOARD_FETCHERS,
      storeDir: path.join(ctx.dataDir, "stores"),
      folders: ctx.folders,
      file: path.join(ctx.dataDir, "watched.json"),
      log: ctx.log,
    });
    void reader.load();
  },
  stop() {
    reader?.stop();
    reader = undefined;
  },
  methods: {
    /** The repositories that can be watched: RepoOption[]. */
    async options() {
      return current().repoOptions(30_000);
    },
    /** The board as last read (Board); starts the next reading when one is due. */
    async board() {
      const r = current();
      await r.load();
      return r.board();
    },
    /** Reads now, and returns the board. */
    async refresh() {
      const r = current();
      await r.load();
      return r.refresh();
    },
    /**
     * Watches { paths } (primary checkouts from `options`) from now on, with { plugins } (the board plugin of each,
     * { path: name }), and returns the board.
     */
    async watch(params) {
      const p = (typeof params === "object" && params !== null ? params : {}) as { paths?: unknown; plugins?: unknown };
      return current().watch(p.paths, p.plugins);
    },
  },
});
