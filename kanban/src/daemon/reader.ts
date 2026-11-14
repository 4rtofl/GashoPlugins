// The kanban of one working server (moved here from the Kanban class of Gasho's apps/daemon/src/kanban.ts of PR #8):
// which repositories it watches and the board plugin chosen for each (kept in the plugin's own folder, ctx.dataDir),
// and what it last read of them. It reads while someone looks: the web part asks for the board every minute while it
// shows, and a request that finds the last reading older than a minute starts the next one. However many browsers
// look, it reads at most once a minute. A repository that fails keeps what it read before, with the error. The board
// plugin's `fetch` runs in every other reading, and not while few of GitHub's GraphQL points are left for the hour.
import fs from "node:fs/promises";
import path from "node:path";
import { PluginError } from "@gasho/plugin-sdk/daemon";
import type { Fetch } from "../../plugins/types.ts";
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
/** What `fetch` gives goes to the web part with the board, as JSON (all of it must stay well under 16 MB). */
const FETCH_MAX_BYTES = 256 * 1024;

/** A board plugin's name: a folder of kanban/plugins/. Only kept here; the web part looks it up in its build. */
const pluginName = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 100 && !v.includes("/");

/** The board plugins of `v` ({ path: name }) for the repositories of `paths`; anything else is left out. */
function pluginsOf(v: unknown, paths: readonly string[]): Record<string, string> {
  if (typeof v !== "object" || v === null) return {};
  return Object.fromEntries(Object.entries(v).filter(([p, name]) => paths.includes(p) && pluginName(name)));
}

/** The `fetch` of the board plugins built in that have one, by their folder's name. */
export type BoardFetchers = ReadonlyMap<string, Fetch>;

/** What a board plugin's `fetch` last did for a repository. */
interface Fetched {
  plugin: string;
  /** When the reading it ran in started. */
  at: number;
  value?: unknown;
  error?: string;
}

/** Why `fetch` failed: gh's own words when gh failed, the plugin's otherwise. */
function fetchError(name: string, e: unknown): string {
  const why = typeof (e as { stderr?: unknown } | null)?.stderr === "string" ? ghError(e) : e instanceof Error ? e.message : String(e);
  return `カンバン用のプラグイン（${name}）の fetch が失敗しました：${why}`;
}

/** `fetch`, with what it gives as JSON, stopped after FETCH_TIMEOUT_MS. */
async function runFetch(fetch: Fetch, material: RepoMaterial, read: GitHubRead): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${FETCH_TIMEOUT_MS / 1000} 秒たっても終わりませんでした。`)), FETCH_TIMEOUT_MS);
  });
  try {
    const value = await Promise.race([fetch(structuredClone(material), { github: { read } }), late]);
    const json = JSON.stringify(value);
    if (json === undefined) return undefined;
    if (Buffer.byteLength(json) > FETCH_MAX_BYTES) throw new Error(`返した値が大きすぎます（JSON で ${FETCH_MAX_BYTES / 1024}KB まで）。`);
    return JSON.parse(json) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

export interface ReaderDeps {
  exec: Exec;
  /** gh, run by gasho-daemon (ctx.github.read). */
  github: GitHubRead;
  /** The board plugins' `fetch` (none in the tests that do not need them). */
  fetchers?: BoardFetchers;
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
  /** `fetch` waits until then: few GraphQL points were left. */
  private fetchPausedUntil = 0;
  private updatedAt: number | undefined;
  private checking = false;
  private again = false;
  private startedAt = -Infinity;
  private reading: Promise<void> | undefined;
  private options: { at: number; folders: string; list: RepoOption[] } | undefined;
  private listing: Promise<RepoOption[]> | undefined;
  private stopped = false;

  constructor(deps: ReaderDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  /** Reads the watched repositories from the file, once. */
  load(): Promise<void> {
    this.loaded ??= fs.readFile(this.deps.file, "utf8").then(
      (raw) => {
        const v = JSON.parse(raw) as { paths?: unknown; plugins?: unknown } | null;
        const paths = Array.isArray(v?.paths) ? v.paths.filter((p): p is string => typeof p === "string") : [];
        this.watched = [...new Set(paths)].slice(0, MAX_REPOS);
        this.plugins = pluginsOf(v?.plugins, this.watched);
      },
      (e: unknown) => {
        if ((e as { code?: unknown }).code !== "ENOENT") this.deps.log("kanban: could not read the watched repositories", e);
      },
    );
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
  async watch(paths: unknown, plugins?: unknown): Promise<Board> {
    await this.load();
    if (!Array.isArray(paths) || !paths.every((p) => typeof p === "string")) throw new PluginError("見る repo の指定が正しくありません。");
    if (plugins !== undefined && (typeof plugins !== "object" || plugins === null || !Object.values(plugins).every(pluginName))) {
      throw new PluginError("カンバン用のプラグインの指定が正しくありません。");
    }
    const next = [...new Set(paths as string[])];
    if (next.length > MAX_REPOS) throw new PluginError(`見る repo は、1 台の working server に ${MAX_REPOS} 個までです。`);
    const added = next.filter((p) => !this.watched.includes(p));
    if (added.length > 0) {
      const offered = new Set((await this.repoOptions(30_000)).filter((o) => o.github).map((o) => o.path));
      const bad = added.filter((p) => !offered.has(p));
      if (bad.length > 0) throw new PluginError(`選べない repo です：${bad.join("、")}`);
    }
    const nextPlugins = pluginsOf(plugins ?? this.plugins, next);
    const moved = JSON.stringify(next) !== JSON.stringify(this.watched);
    // A repository given a board plugin with a `fetch` is read again, for what its `state` gets.
    const toFetch = next.some((p) => nextPlugins[p] !== this.plugins[p] && this.fetcher(nextPlugins[p]));
    if (moved || JSON.stringify(nextPlugins) !== JSON.stringify(this.plugins)) {
      await fs.mkdir(path.dirname(this.deps.file), { recursive: true });
      const tmp = `${this.deps.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify({ paths: next, plugins: nextPlugins }, null, 2)}\n`);
      await fs.rename(tmp, this.deps.file);
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
    return name === undefined ? undefined : this.deps.fetchers?.get(name);
  }

  /** Whether the board plugin of `p` has a `fetch` to run in this reading. */
  private fetchDue(p: string, fresh: boolean): boolean {
    if (!this.fetcher(this.plugins[p])) return false;
    const f = this.fetched.get(p);
    return fresh || !f || this.now() - f.at >= FETCH_EVERY_MS;
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
        const done = await runFetch(fetch, material, gh).then(
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
