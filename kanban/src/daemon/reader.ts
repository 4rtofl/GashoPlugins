// The kanban of one working server (moved here from the Kanban class of Gasho's apps/daemon/src/kanban.ts of PR #8):
// which repositories it watches and the board plugin chosen for each (kept in the plugin's own folder, ctx.dataDir),
// and what it last read of them. It reads while someone looks: the web part asks for the board every minute while it
// shows, and a request that finds the last reading older than a minute starts the next one. However many browsers
// look, it reads at most once a minute. A repository that fails keeps what it read before, with the error. The board
// plugin's `fetch` runs in every other reading, and not while few of GitHub's GraphQL points are left for the hour; what
// it keeps for itself (FetchStore) is in a file of its own for each repository.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PluginError } from "@gasho/plugin-sdk/daemon";
import type { Fetch, FetchContext, FetchStore } from "../../plugins/types.ts";
import { MAX_REPOS, type Board, type RepoMaterial, type RepoOption } from "../types.ts";
import { ghError, KanbanError, readRepo, repoOptions, type Exec, type GitHubRead } from "./git.ts";

/** A request finds a reading due when the last one started this long ago (the web part asks every 60 seconds). */
export const READ_EVERY_MS = 50_000;
/** "今すぐ見直す" does not read again when the last reading started less than this ago. */
const REFRESH_MIN_MS = 10_000;
/** Repositories read at the same time (each is `git worktree list` and `gh` twice). */
const PARALLEL = 4;
/** The repositories that can be watched are listed again when the folders change, or when the list is this old. */
const OPTIONS_MAX_AGE_MS = 5 * 60_000;
/**
 * A board plugin's `fetch` runs in a reading when it last ran this long ago: every other reading, as they are a minute
 * apart. Reading a repository costs 2 of GitHub's GraphQL points (5000 an hour), so 120 an hour while the board shows;
 * a `fetch` that costs as much adds 60.
 */
export const FETCH_EVERY_MS = 110_000;
/** `fetch` waits for the next hour while fewer GraphQL points than this are left, for the person's own gh and the other plugins. */
export const FETCH_RESERVE_POINTS = 1000;
const FETCH_TIMEOUT_MS = 60_000;
/** What `fetch` gives goes to the web part with the board, as JSON (all of it must stay well under 16 MB); what it keeps, too. */
const FETCH_MAX_BYTES = 256 * 1024;

/** A board plugin's name: a folder of the board plugins' folder. Only kept here; the web part gets their code itself. */
const pluginName = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 100 && !v.includes("/");

/** The board plugins of `v` ({ path: name }) for the repositories of `paths`; anything else is left out. */
function pluginsOf(v: unknown, paths: readonly string[]): Record<string, string> {
  if (typeof v !== "object" || v === null) return {};
  return Object.fromEntries(Object.entries(v).filter(([p, name]) => paths.includes(p) && pluginName(name)));
}

/** What a board plugin's `fetch` last did for a repository. */
interface Fetched {
  plugin: string;
  /** When the reading it ran in started. */
  at: number;
  value?: unknown;
  error?: string;
}

/** The errors `fetch` got from gh ("gh") and from the commands it ran (their name), as they came. */
const failedIn = new WeakMap<object, string>();

/** Notes that `e` came from `what` (gh, or a command's name), and throws it on. */
const thrownBy =
  (what: string) =>
  (e: unknown): never => {
    if (typeof e === "object" && e !== null) failedIn.set(e, what);
    throw e;
  };

/** Why a command `fetch` ran failed (ctx.exec throws as Node.js's execFile does). */
function commandError(command: string, e: unknown): string {
  const err = (e ?? {}) as { code?: unknown; killed?: unknown; stderr?: unknown; message?: unknown };
  if (err.code === "ENOENT") return `working server に ${command} がありません。`;
  if (err.killed === true) return `${command} が時間内に終わりませんでした。`;
  const first = [err.stderr, err.message]
    .filter((t): t is string => typeof t === "string")
    .join("\n")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("Command failed"));
  return `${command} が失敗しました：${(first ?? "原因が分かりません").slice(0, 200)}`;
}

/** Why `fetch` failed: gh's words when what it threw came from gh, the command's when from a command, the plugin's otherwise. */
function fetchError(name: string, e: unknown): string {
  const from = typeof e === "object" && e !== null ? failedIn.get(e) : undefined;
  const why = from === "gh" ? ghError(e) : from !== undefined ? commandError(from, e) : e instanceof Error ? e.message : String(e);
  return `カンバン用のプラグイン（${name}）の fetch が失敗しました：${why}`;
}

/** Writes `text` to `file` whole or not at all: through a file of its own, renamed over it. */
async function writeWhole(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, text);
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

/** `value` as JSON, up to FETCH_MAX_BYTES; `what` names it when it is larger. */
function asJson(value: unknown, what: string): string | undefined {
  const json = JSON.stringify(value);
  if (json !== undefined && Buffer.byteLength(json) > FETCH_MAX_BYTES) throw new Error(`${what}が大きすぎます（JSON で ${FETCH_MAX_BYTES / 1024}KB まで）。`);
  return json;
}

/** `fetch`, with what it gives as JSON, stopped after FETCH_TIMEOUT_MS. */
async function runFetch(fetch: Fetch, material: RepoMaterial, ctx: FetchContext): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${FETCH_TIMEOUT_MS / 1000} 秒たっても終わりませんでした。`)), FETCH_TIMEOUT_MS);
  });
  try {
    const json = asJson(await Promise.race([fetch(structuredClone(material), ctx), late]), "返した値");
    return json === undefined ? undefined : (JSON.parse(json) as unknown);
  } finally {
    clearTimeout(timer);
  }
}

/** The store of the board plugin `name` for the repository `p`: its file, read now, and written on each `set`. */
async function openStore(dir: string, name: string, p: string, log: ReaderDeps["log"]): Promise<FetchStore> {
  const file = path.join(dir, name, `${createHash("sha256").update(p).digest("hex").slice(0, 16)}.json`);
  let kept: unknown;
  try {
    kept = (JSON.parse(await fs.readFile(file, "utf8")) as { value?: unknown } | null)?.value;
  } catch (e) {
    if ((e as { code?: unknown }).code !== "ENOENT") log(`kanban: could not read what ${name} kept for ${p}`, e);
  }
  // One write at a time, so that the last `set` is the one in the file.
  let writing: Promise<void> = Promise.resolve();
  return {
    get: () => (kept === undefined ? undefined : structuredClone(kept)),
    async set(value) {
      const json = asJson({ path: p, value }, "store に入れる値") ?? "{}";
      kept = (JSON.parse(json) as { value?: unknown }).value;
      writing = writing.catch(() => undefined).then(() => writeWhole(file, `${json}\n`));
      return writing;
    },
  };
}

export interface ReaderDeps {
  exec: Exec;
  /** gh, run by gasho-daemon (ctx.github.read). */
  github: GitHubRead;
  /** The `fetch` of the board plugin `name`, when it has one (none in the tests that do not need them). */
  fetcher?: (name: string) => Fetch | undefined;
  /** The folder of what they keep (FetchStore): a folder for each plugin, a file for each repository. */
  storeDir: string;
  /** The folders Gasho can start sessions in (ctx.folders). */
  folders: () => string[];
  /** The file that keeps the watched repositories. */
  file: string;
  log: (...args: unknown[]) => void;
  now?: () => number;
}

export class Reader {
  private deps: ReaderDeps;
  private now: () => number;
  private watched: string[] = [];
  private plugins: Record<string, string> = {};
  private loaded: Promise<void> | undefined;
  private material = new Map<string, RepoMaterial>();
  private errors = new Map<string, string>();
  private fetched = new Map<string, Fetched>();
  /** Repositories whose board plugin's code changed: their `fetch` runs in the next reading. */
  private refetch = new Set<string>();
  /** `fetch` waits until then: few GraphQL points were left. */
  private fetchPausedUntil = 0;
  private updatedAt: number | undefined;
  private checking = false;
  private again = false;
  private startedAt = -Infinity;
  private reading: Promise<void> | undefined;
  private options: { at: number; folders: string; list: RepoOption[] } | undefined;
  private listing: Promise<RepoOption[]> | undefined;
  /** The `watch` going on: one at a time, so that the file and what is watched here are the last one's. */
  private watching: Promise<unknown> = Promise.resolve();
  private stopped = false;

  constructor(deps: ReaderDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  /** Reads the watched repositories from the file, once. A file that cannot be read watches none, until the next `watch`. */
  load(): Promise<void> {
    this.loaded ??= fs
      .readFile(this.deps.file, "utf8")
      .then((raw) => {
        const v = JSON.parse(raw) as { paths?: unknown; plugins?: unknown } | null;
        const paths = Array.isArray(v?.paths) ? v.paths.filter((p): p is string => typeof p === "string") : [];
        this.watched = [...new Set(paths)].slice(0, MAX_REPOS);
        this.plugins = pluginsOf(v?.plugins, this.watched);
      })
      .catch((e: unknown) => {
        if ((e as { code?: unknown }).code !== "ENOENT") this.deps.log("kanban: could not read the watched repositories; watching none", e);
      });
    return this.loaded;
  }

  /** The repositories that can be watched, listed again when the folders changed or the list is older than `maxAgeMs`. */
  repoOptions(maxAgeMs = OPTIONS_MAX_AGE_MS): Promise<RepoOption[]> {
    const folders = this.deps.folders();
    const key = JSON.stringify(folders);
    const c = this.options;
    if (c && c.folders === key && this.now() - c.at < maxAgeMs) return Promise.resolve(c.list);
    this.listing ??= repoOptions(this.deps.exec, folders)
      .then((list) => {
        this.options = { at: this.now(), folders: key, list };
        return list;
      })
      .finally(() => {
        this.listing = undefined;
      });
    return this.listing;
  }

  /** The board as last read; starts the next reading when one is due. */
  board(): Board {
    if (this.now() - this.startedAt >= READ_EVERY_MS) void this.read();
    return this.snapshot();
  }

  /** Reads now ("今すぐ見直す") without what gasho-daemon kept of gh, unless a reading is going on or started just before. */
  refresh(): Board {
    if (!this.checking && this.now() - this.startedAt >= REFRESH_MIN_MS) void this.read(true);
    return this.snapshot();
  }

  /**
   * Watches `paths` from now on, with the board plugins `plugins` ({ path: name }; the ones chosen before when it is
   * not given), and keeps them in the file. Each path must be a repository on GitHub that can be watched now, or one
   * watched already (whose folder may be gone: it can stay until it is taken off).
   */
  watch(paths: unknown, plugins?: unknown): Promise<Board> {
    const done = this.watching.then(() => this.watchNow(paths, plugins));
    this.watching = done.catch(() => undefined);
    return done;
  }

  private async watchNow(paths: unknown, plugins?: unknown): Promise<Board> {
    await this.load();
    if (!Array.isArray(paths) || !paths.every((p) => typeof p === "string")) throw new PluginError("見る repo の指定が正しくありません。");
    if (plugins !== undefined && (typeof plugins !== "object" || plugins === null || !Object.values(plugins).every(pluginName))) {
      throw new PluginError("カンバン用のプラグインの指定が正しくありません。");
    }
    const next = [...new Set(paths as string[])];
    if (next.length > MAX_REPOS) throw new PluginError(`見る repo は、1 台の working server に ${MAX_REPOS} 個までです。`);
    const added = next.filter((p) => !this.watched.includes(p));
    if (added.length > 0) {
      // Those the dialog was offered are in the list it got, kept a while; it is made again only for others.
      const offered = async (maxAgeMs: number) => new Set((await this.repoOptions(maxAgeMs)).filter((o) => o.github).map((o) => o.path));
      let ok = await offered(OPTIONS_MAX_AGE_MS);
      if (added.some((p) => !ok.has(p))) ok = await offered(30_000);
      const bad = added.filter((p) => !ok.has(p));
      if (bad.length > 0) throw new PluginError(`選べない repo です：${bad.join("、")}`);
    }
    const nextPlugins = pluginsOf(plugins ?? this.plugins, next);
    const moved = JSON.stringify(next) !== JSON.stringify(this.watched);
    // A repository given a board plugin with a `fetch` is read again, for what its `state` gets.
    const toFetch = next.some((p) => nextPlugins[p] !== this.plugins[p] && this.fetcher(nextPlugins[p]));
    if (moved || JSON.stringify(nextPlugins) !== JSON.stringify(this.plugins)) {
      await writeWhole(this.deps.file, `${JSON.stringify({ paths: next, plugins: nextPlugins }, null, 2)}\n`);
      this.watched = next;
      this.plugins = nextPlugins;
    }
    if (moved) {
      for (const map of [this.material, this.errors]) {
        for (const p of [...map.keys()]) if (!next.includes(p)) map.delete(p);
      }
    }
    // What another plugin fetched is not for this one's `state`.
    for (const [p, f] of this.fetched) if (f.plugin !== this.plugins[p]) this.fetched.delete(p);
    if (moved || toFetch) void this.read();
    return this.snapshot();
  }

  /**
   * The code of the board plugins `names` changed (saved in their folder): the repositories that chose one of them with a
   * `fetch` are read again, for what the new `fetch` gives.
   */
  pluginsChanged(names: ReadonlySet<string>): void {
    const due = this.watched.filter((p) => names.has(this.plugins[p] ?? "") && this.fetcher(this.plugins[p]));
    for (const p of due) this.refetch.add(p);
    // Only while the board shows somewhere (it was read lately); else in the next reading.
    if (due.length > 0 && this.now() - this.startedAt < 2 * READ_EVERY_MS) void this.read();
  }

  /**
   * The watched repository whose primary checkout is `primary` (a real path, as in the board), as last read, with its
   * board plugin and what its `fetch` gave: for writing its cards out.
   */
  repo(primary: string): { material: RepoMaterial; plugin?: string; fetched?: unknown } | undefined {
    const p = this.watched.find((w) => this.material.get(w)?.primary.path === primary);
    const material = p === undefined ? undefined : this.material.get(p);
    if (p === undefined || !material) return undefined;
    const plugin = this.plugins[p];
    const fetched = this.fetched.get(p)?.value;
    return { material, ...(plugin ? { plugin } : {}), ...(fetched !== undefined ? { fetched } : {}) };
  }

  /** Stops reading (the process is being stopped). */
  stop(): void {
    this.stopped = true;
  }

  /** The reading going on, if any (for tests). */
  settled(): Promise<void> {
    return this.reading ?? Promise.resolve();
  }

  private label(p: string): string {
    return this.options?.list.find((o) => o.path === p)?.github ?? path.basename(p);
  }

  private fetcher(name: string | undefined): Fetch | undefined {
    return name === undefined ? undefined : this.deps.fetcher?.(name);
  }

  /** Whether the board plugin of `p` has a `fetch` to run in this reading. */
  private fetchDue(p: string, fresh: boolean): boolean {
    if (!this.fetcher(this.plugins[p])) return false;
    const f = this.fetched.get(p);
    return fresh || !f || this.refetch.has(p) || this.now() - f.at >= FETCH_EVERY_MS;
  }

  /** Whether `fetch` may run: not while fewer than FETCH_RESERVE_POINTS GraphQL points are left (`gh api rate_limit` costs none). */
  private async fetchAllowed(): Promise<boolean> {
    if (this.now() < this.fetchPausedUntil) return false;
    this.fetchPausedUntil = 0;
    try {
      const { stdout } = await this.deps.github(["api", "rate_limit"], { timeoutMs: 15_000 });
      const graphql = (JSON.parse(stdout) as { resources?: { graphql?: { remaining?: unknown; reset?: unknown } } } | null)?.resources?.graphql;
      if (typeof graphql?.remaining === "number" && typeof graphql.reset === "number" && graphql.remaining < FETCH_RESERVE_POINTS) {
        this.fetchPausedUntil = graphql.reset * 1000;
        return false;
      }
    } catch (e) {
      // Without the points left, fetch still runs: a gh that cannot answer this fails in the reading anyway.
      this.deps.log("kanban: could not read how many of GitHub's points are left", e);
    }
    return true;
  }

  private snapshot(): Board {
    return {
      watched: [...this.watched],
      plugins: { ...this.plugins },
      repos: this.watched.flatMap((p) => {
        const m = this.material.get(p);
        const plugin = this.plugins[p];
        const fetched = this.fetched.get(p)?.value;
        return m ? [{ ...m, ...(plugin ? { plugin } : {}), ...(fetched !== undefined ? { fetched } : {}) }] : [];
      }),
      errors: this.watched.flatMap((p) => {
        const error = this.errors.get(p) ?? this.fetched.get(p)?.error;
        return error ? [{ path: p, repo: this.label(p), error }] : [];
      }),
      ...(this.updatedAt ? { updatedAt: this.updatedAt } : {}),
      ...(this.checking ? { checking: true } : {}),
      ...(this.now() < this.fetchPausedUntil ? { fetchPausedUntil: this.fetchPausedUntil } : {}),
    };
  }

  /** Reads the watched repositories; `fresh`: without what gasho-daemon kept of gh, and every `fetch` with them. */
  private read(fresh = false): Promise<void> {
    if (this.stopped || this.watched.length === 0) return Promise.resolve();
    if (this.checking) {
      // The repositories changed while reading: read again after it, for the ones just added.
      this.again = true;
      return this.reading ?? Promise.resolve();
    }
    this.checking = true;
    this.startedAt = this.now();
    this.reading = this.readAll(fresh).finally(() => {
      this.checking = false;
      this.reading = undefined;
      if (this.again) {
        this.again = false;
        void this.read();
      }
    });
    return this.reading;
  }

  private async readAll(fresh: boolean): Promise<void> {
    const options = await this.repoOptions().catch((e: unknown) => {
      this.deps.log("kanban: could not list the repositories that can be watched", e);
      return this.options?.list ?? [];
    });
    // gh, as the reading and `fetch` run it: with "今すぐ見直す", not answered from what gasho-daemon kept.
    const gh: GitHubRead = (args, o) => this.deps.github(args, { ...(fresh ? { maxAgeSeconds: 0 } : {}), ...o });
    const fetching = this.watched.some((p) => this.fetchDue(p, fresh)) && (await this.fetchAllowed());
    const queue = [...this.watched];
    let readOne = false;
    const worker = async () => {
      for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
        const option = options.find((o) => o.path === p);
        let material: RepoMaterial;
        try {
          if (!option) throw new KanbanError("Claude Code が信頼しているフォルダーの repo ではないので、見られません。");
          material = await readRepo(this.deps.exec, gh, option);
          if (!this.watched.includes(p)) continue;
          this.material.set(p, material);
          this.errors.delete(p);
          readOne = true;
        } catch (e) {
          if (!this.watched.includes(p)) continue;
          const text = e instanceof KanbanError ? e.message : `読み込めませんでした：${e instanceof Error ? e.message : String(e)}`;
          if (!(e instanceof KanbanError)) this.deps.log(`kanban: could not read ${p}`, e);
          this.errors.set(p, text);
          continue;
        }
        const name = this.plugins[p];
        const fetch = this.fetcher(name);
        if (!fetching || !fetch || name === undefined || !this.fetchDue(p, fresh)) continue;
        const last = this.fetched.get(p);
        const at = this.startedAt;
        this.refetch.delete(p);
        const done = await openStore(this.deps.storeDir, name, p, this.deps.log)
          .then((store) =>
            runFetch(fetch, material, {
              github: { read: (args, o) => gh(args, o).catch(thrownBy("gh")) },
              exec: (command, args, o) => this.deps.exec(command, args, o).catch(thrownBy(command)),
              store,
            }),
          )
          .then(
            (value): Fetched => ({ plugin: name, at, value }),
            (e: unknown): Fetched => ({ plugin: name, at, ...(last?.value !== undefined ? { value: last.value } : {}), error: fetchError(name, e) }),
          );
        // The repository may have been taken off, or given another plugin, while it ran.
        if (this.watched.includes(p) && this.plugins[p] === name) this.fetched.set(p, done);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
    if (readOne) this.updatedAt = this.now();
  }
}
