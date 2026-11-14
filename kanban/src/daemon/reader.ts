// The kanban of one working server (moved here from the Kanban class of Gasho's apps/daemon/src/kanban.ts of PR #8):
// which repositories it watches (kept in the plugin's own folder, ctx.dataDir), and what it last read of them. It
// reads while someone looks: the web part asks for the board every minute while it shows, and a request that finds the
// last reading older than a minute starts the next one. However many browsers look, it reads at most once a minute. A
// repository that fails keeps what it read before, with the error.
import fs from "node:fs/promises";
import path from "node:path";
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { MAX_REPOS, type Board, type RepoMaterial, type RepoOption } from "../types.ts";
import { KanbanError, readRepo, repoOptions, type Exec } from "./git.ts";

/** A request finds a reading due when the last one started this long ago (the web part asks every 60 seconds). */
export const READ_EVERY_MS = 50_000;
/** "今すぐ見直す" does not read again when the last reading started less than this ago. */
const REFRESH_MIN_MS = 10_000;
/** Repositories read at the same time (each is `git worktree list` and `gh` twice). */
const PARALLEL = 4;
/** The repositories that can be watched are listed again when the folders change, or when the list is this old. */
const OPTIONS_MAX_AGE_MS = 5 * 60_000;

export interface ReaderDeps {
  exec: Exec;
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
  private loaded: Promise<void> | undefined;
  private material = new Map<string, RepoMaterial>();
  private errors = new Map<string, string>();
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
        const v = JSON.parse(raw) as { paths?: unknown } | null;
        const paths = Array.isArray(v?.paths) ? v.paths.filter((p): p is string => typeof p === "string") : [];
        this.watched = [...new Set(paths)].slice(0, MAX_REPOS);
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

  /** Reads now ("今すぐ見直す"), unless a reading is going on or started just before. */
  refresh(): Board {
    if (!this.checking && this.now() - this.startedAt >= REFRESH_MIN_MS) void this.read();
    return this.snapshot();
  }

  /**
   * Watches `paths` from now on and keeps them in the file. Each must be a repository on GitHub that can be watched
   * now, or one watched already (whose folder may be gone: it can stay until it is taken off).
   */
  async watch(paths: unknown): Promise<Board> {
    await this.load();
    if (!Array.isArray(paths) || !paths.every((p) => typeof p === "string")) throw new PluginError("見る repo の指定が正しくありません。");
    const next = [...new Set(paths as string[])];
    if (next.length > MAX_REPOS) throw new PluginError(`見る repo は、1 台の working server に ${MAX_REPOS} 個までです。`);
    const added = next.filter((p) => !this.watched.includes(p));
    if (added.length > 0) {
      const offered = new Set((await this.repoOptions(30_000)).filter((o) => o.github).map((o) => o.path));
      const bad = added.filter((p) => !offered.has(p));
      if (bad.length > 0) throw new PluginError(`選べない repo です：${bad.join("、")}`);
    }
    if (JSON.stringify(next) !== JSON.stringify(this.watched)) {
      await fs.mkdir(path.dirname(this.deps.file), { recursive: true });
      const tmp = `${this.deps.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify({ paths: next }, null, 2)}\n`);
      await fs.rename(tmp, this.deps.file);
      this.watched = next;
      for (const map of [this.material, this.errors]) {
        for (const p of [...map.keys()]) if (!next.includes(p)) map.delete(p);
      }
      void this.read();
    }
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

  private snapshot(): Board {
    return {
      watched: [...this.watched],
      repos: this.watched.flatMap((p) => this.material.get(p) ?? []),
      errors: this.watched.flatMap((p) => {
        const error = this.errors.get(p);
        return error ? [{ path: p, repo: this.label(p), error }] : [];
      }),
      ...(this.updatedAt ? { updatedAt: this.updatedAt } : {}),
      ...(this.checking ? { checking: true } : {}),
    };
  }

  private read(): Promise<void> {
    if (this.stopped || this.watched.length === 0) return Promise.resolve();
    if (this.checking) {
      // The repositories changed while reading: read again after it, for the ones just added.
      this.again = true;
      return this.reading ?? Promise.resolve();
    }
    this.checking = true;
    this.startedAt = this.now();
    this.reading = this.readAll().finally(() => {
      this.checking = false;
      this.reading = undefined;
      if (this.again) {
        this.again = false;
        void this.read();
      }
    });
    return this.reading;
  }

  private async readAll(): Promise<void> {
    const options = await this.repoOptions().catch((e: unknown) => {
      this.deps.log("kanban: could not list the repositories that can be watched", e);
      return this.options?.list ?? [];
    });
    const queue = [...this.watched];
    let read = false;
    const worker = async () => {
      for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
        const option = options.find((o) => o.path === p);
        try {
          if (!option) throw new KanbanError("Claude Code が信頼しているフォルダーの repo ではないので、見られません。");
          const material = await readRepo(this.deps.exec, option);
          if (!this.watched.includes(p)) continue;
          this.material.set(p, material);
          this.errors.delete(p);
          read = true;
        } catch (e) {
          if (!this.watched.includes(p)) continue;
          const text = e instanceof KanbanError ? e.message : `読み込めませんでした：${e instanceof Error ? e.message : String(e)}`;
          if (!(e instanceof KanbanError)) this.deps.log(`kanban: could not read ${p}`, e);
          this.errors.set(p, text);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
    if (read) this.updatedAt = this.now();
  }
}
