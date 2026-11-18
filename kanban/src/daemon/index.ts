// The daemon part of the kanban plugin: on each working server, the repositories that can be watched (from the folders
// Gasho can start sessions in), and the worktrees and my pull requests of the watched ones, read with git and gh, with
// what their board plugins' `fetch` gives. The board plugins live in the kanban's folder of the working server
// (folder.ts), read again whenever a file there is saved: the web parts hear of it ("plugins") and ask for their code.
// The web part asks for the board every minute while it shows.
import path from "node:path";
import { defineDaemonPlugin, PluginError } from "@gasho/plugin-sdk/daemon";
import type { StateCard } from "../../plugins/types.ts";
import type { Board } from "../types.ts";
import { PLACED, SAMPLE } from "./board-plugins.ts";
import { BoardFolder } from "./folder.ts";
import { Reader } from "./reader.ts";

let running: { reader: Reader; folder: BoardFolder; ready: Promise<unknown> } | undefined;

async function current(): Promise<{ reader: Reader; folder: BoardFolder }> {
  if (!running) throw new PluginError("カンバンの daemon の部分が、まだ動き始めていません。");
  await running.ready;
  await running.reader.load();
  return running;
}

const withPlugins = (board: Board, folder: BoardFolder): Board => ({ ...board, pluginsVersion: folder.current().version });

/** The file name of a watched repository's cards: OWNER__REPO, and its folder's name when two clones of it are watched. */
function cardsName(repo: string, p: string, board: Board): string {
  const name = repo.replace("/", "__");
  return board.repos.filter((r) => r.repo === repo).length > 1 ? `${name}__${path.basename(p)}` : name;
}

export default defineDaemonPlugin({
  start(ctx) {
    const folder = new BoardFolder({ dir: path.join(ctx.dataDir, "plugins"), placed: PLACED, sample: SAMPLE, log: ctx.log });
    const reader = new Reader({
      exec: ctx.exec,
      github: (args, o) => ctx.github.read(args, o),
      fetcher: (name) => folder.fetcher(name),
      storeDir: path.join(ctx.dataDir, "stores"),
      folders: ctx.folders,
      file: path.join(ctx.dataDir, "watched.json"),
      log: ctx.log,
    });
    // Kept by the Gasho server for the pages that open later.
    const tell = (version: string) => {
      try {
        ctx.emit("plugins", { version }, { retain: true });
      } catch (e) {
        ctx.log("kanban: could not tell the web parts that the board plugins changed", e);
      }
    };
    const ready = folder.start((set, changed) => {
      // The reading for the new `fetch` starts first, so that the board the web part asks for on hearing it says so.
      reader.pluginsChanged(changed);
      tell(set.version);
    });
    running = { reader, folder, ready: ready.then((set) => tell(set.version)) };
    void reader.load();
  },
  stop() {
    running?.reader.stop();
    running?.folder.stop();
    running = undefined;
  },
  methods: {
    /** The repositories that can be watched: RepoOption[]. */
    async options() {
      return (await current()).reader.repoOptions(30_000);
    },
    /** The board as last read (Board); starts the next reading when one is due. */
    async board() {
      const { reader, folder } = await current();
      return withPlugins(reader.board(), folder);
    },
    /** Reads now, and returns the board. */
    async refresh() {
      const { reader, folder } = await current();
      return withPlugins(reader.refresh(), folder);
    },
    /**
     * Watches { paths } (primary checkouts from `options`) from now on, with { plugins } (the board plugin of each,
     * { path: name }), and returns the board.
     */
    async watch(params) {
      const p = (typeof params === "object" && params !== null ? params : {}) as { paths?: unknown; plugins?: unknown };
      const { reader, folder } = await current();
      return withPlugins(await reader.watch(p.paths, p.plugins), folder);
    },
    /** The board plugins in the folder, with their code for the web part (PluginSet). */
    async plugins() {
      return (await current()).folder.current();
    },
    /**
     * Writes the cards { repos: [{ path, cards }] } (StateCard[] of the watched repository whose primary checkout is
     * `path`, as the web part made them)
     * to the folder's cards/, each with the repository as `fetch` gets it and what its `fetch` gave, for check.ts.
     */
    async exportCards(params) {
      const { repos } = (typeof params === "object" && params !== null ? params : {}) as { repos?: unknown };
      if (!Array.isArray(repos)) throw new PluginError("書き出すカードの指定が正しくありません。");
      const { reader, folder } = await current();
      const board = reader.board();
      const files: string[] = [];
      for (const r of repos as { path?: unknown; cards?: unknown }[]) {
        if (typeof r?.path !== "string" || !Array.isArray(r.cards)) throw new PluginError("書き出すカードの指定が正しくありません。");
        const at = reader.repo(r.path);
        if (!at) throw new PluginError(`見ていない repo です：${r.path}`);
        const { material, plugin, fetched } = at;
        const value = { exportedAt: new Date().toISOString(), plugin, repo: material, fetched, cards: r.cards as StateCard[] };
        files.push(await folder.writeCards(cardsName(material.repo, r.path, board), value));
      }
      return { dir: path.join(folder.current().dir, "cards"), files };
    },
  },
});
