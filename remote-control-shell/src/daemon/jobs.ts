// The commands of Remote Control Shell on one working server (README.md「daemon の部分」). Each command gets a shell of
// its own, in a process group of its own, in the working folder of its session folder. Its output is kept in memory up
// to a limit and written to the plugin's folder, and `watch` answers as soon as something changes. Records and the
// working folder belong to the session folder, so that a session started again in the same folder finds them.
//
// Records found running for another process of this plugin (the old version, during a hot reload) are shown as that
// process writes them; once it has gone, any of them it left running are ended here. A record's PIDs are trusted only
// while they name the processes it was written for (proc.ts): another process may have got them since.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import { StringDecoder } from "node:string_decoder";
import { PluginError } from "@gasho/plugin-sdk/daemon";
import type { OutputAnswer, OutputPiece, RunAnswer, ShellJob, ShellView, StatusAnswer } from "../types.ts";
import { OutputBuffer } from "./output.ts";
import { processStart, sameProcess } from "./proc.ts";
import { pickShell, shellArgs, shellEnv, type ShellChoice, type Startup } from "./shell.ts";
import { folderKey, Store, type StoredJob } from "./store.ts";

export interface ShellSettings {
  shell: ShellChoice;
  startup: Startup;
  /** Characters of output kept per command. */
  maxOutput: number;
  /** Records kept per session folder. */
  keepJobs: number;
}

export const DEFAULT_SETTINGS: ShellSettings = { shell: "auto", startup: "login", maxOutput: 1024 * 1024, keepJobs: 50 };

/** The settings as the Gasho server passes them (scope "server"); anything odd counts as the default. */
export function settingsFrom(values: Record<string, unknown>): ShellSettings {
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
  const int = (v: unknown, min: number, max: number, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
  return {
    shell: pick(values.shell, ["auto", "bash", "zsh", "sh"] as const, DEFAULT_SETTINGS.shell),
    startup: pick(values.startup, ["login", "interactive", "plain"] as const, DEFAULT_SETTINGS.startup),
    maxOutput: int(values.maxOutputKB, 64, 8192, 1024) * 1024,
    keepJobs: int(values.keepJobs, 10, 500, DEFAULT_SETTINGS.keepJobs),
  };
}

/** Commands running at once in one session folder, and on the working server. */
export const MAX_RUNNING_PER_FOLDER = 4;
export const MAX_RUNNING = 16;
/** `watch` calls waiting at once: gasho-daemon runs 8 calls of a plugin at a time, and `run` and `signal` must get through. */
export const MAX_WAITING = 4;
/** Output per `watch` answer and per `output` answer (characters). */
const WATCH_BUDGET = 256 * 1024;
export const OUTPUT_BUDGET = 1024 * 1024;
/** New output goes to its file this long after it came. */
const FLUSH_MS = 3000;
/** Once something changed, an answer waits this long for more of it. */
const BATCH_MS = 30;
/** stop(): SIGTERM first, SIGKILL after this long. */
const TERM_MS = 2000;
/** How often records running for another process of the plugin are looked at again. */
const FOREIGN_CHECK_MS = 2000;
/** Outputs of ended commands kept in memory once read. */
const CACHED_OUTPUTS = 8;
/** The records of a session folder that has gone are removed this long after it was first found gone. */
export const GONE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
/** How often the records of gone session folders are looked for. */
const SWEEP_MS = 6 * 60 * 60 * 1000;

/** This process's part of every version, so that one from before a restart never matches. */
const EPOCH = randomBytes(3).toString("hex");

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const newId = (): string => `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function killGroup(pgid: number | undefined, signal: NodeJS.Signals): boolean {
  if (!pgid) return false;
  try {
    process.kill(-pgid, signal);
    return true;
  } catch {
    return false;
  }
}

/** A record as the panel gets it. */
const publicJob = ({ owner: _owner, ownerStart: _ownerStart, pgid: _pgid, pgidStart: _pgidStart, request: _request, logFrom: _logFrom, ...job }: StoredJob): ShellJob =>
  job;

class Job {
  meta: StoredJob;
  /**
   * Run by this process (not by another version of the plugin). A record read from its file never is: the process that
   * wrote it may have had the PID this one has.
   */
  readonly mine: boolean;
  /** Its output in memory: while it runs here, or once read from its file. */
  out?: OutputBuffer;
  child?: ChildProcess;
  /** The last signal sent to it from here, and whether it ends because the plugin stops. */
  sent?: NodeJS.Signals;
  lost = false;
  /** Its file holds its output up to here. */
  flushedTo = 0;
  flushTimer?: NodeJS.Timeout;
  /** Settles once it has ended and its record is written. */
  readonly ended: Promise<void>;
  private settle: () => void = () => undefined;

  constructor(meta: StoredJob, mine = false) {
    this.meta = meta;
    this.mine = mine;
    this.ended = new Promise<void>((resolve) => {
      this.settle = resolve;
    });
    if (meta.state !== "running") this.settle();
  }

  get running(): boolean {
    return this.meta.state === "running";
  }

  done(): void {
    this.settle();
  }
}

class Folder {
  readonly key: string;
  readonly path: string;
  cwd: string;
  jobs: Job[] = [];
  /** The command started last: only its end moves the working folder (README.md「作業フォルダー」). */
  lastStarted?: string;
  foreignTimer?: NodeJS.Timeout;
  settling = false;
  private n = 0;
  private readonly listeners = new Set<() => void>();
  private writes: Promise<void> = Promise.resolve();

  constructor(key: string, path: string, cwd: string) {
    this.key = key;
    this.path = path;
    this.cwd = cwd;
  }

  get version(): string {
    return `${EPOCH}.${this.n}`;
  }

  /** The list changed: a command started or ended, the working folder moved, records went. */
  bump(): void {
    this.n++;
    this.changed();
  }

  /** Something changed, the output of a command too: waiting watches look again. */
  changed(): void {
    for (const listener of [...this.listeners]) listener();
  }

  find(id: string): Job | undefined {
    return this.jobs.find((j) => j.meta.id === id);
  }

  get running(): number {
    return this.jobs.filter((j) => j.running).length;
  }

  /** Runs `task` after the folder's earlier writes, one at a time; a failure is logged. */
  write(task: () => Promise<unknown>, log: (...args: unknown[]) => void): Promise<void> {
    const next = this.writes.then(task).then(
      () => undefined,
      (e: unknown) => log("could not write", e),
    );
    this.writes = next;
    return next;
  }

  idle(): Promise<void> {
    return this.writes;
  }

  /** Waits until `ready` holds, for `ms` at most; true when a change made it hold. */
  wait(ready: () => boolean, ms: number, signal: AbortSignal | undefined): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (woke: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.listeners.delete(check);
        signal?.removeEventListener("abort", onAbort);
        resolve(woke);
      };
      const check = () => {
        if (ready()) finish(true);
      };
      const onAbort = () => finish(false);
      const timer = setTimeout(() => finish(false), ms);
      this.listeners.add(check);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) finish(false);
    });
  }
}

export interface RunInput {
  command?: string;
  /** Runs the command of this record again, in the folder it ran in. */
  again?: string;
  cols?: number;
  /**
   * The panel's name for this request, the same when it sends it again after getting no answer: a record started for
   * it is answered instead of running the command twice (README.md「メソッド」).
   */
  request?: string;
}

export interface WatchInput {
  since?: string;
  offsets: Record<string, number>;
  waitMs: number;
}

export class Shells {
  private readonly store: Store;
  private readonly env: NodeJS.ProcessEnv;
  private readonly log: (...args: unknown[]) => void;
  private readonly home: string;
  private readonly folders = new Map<string, Promise<Folder>>();
  private readonly loaded = new Map<string, Folder>();
  private readonly cached: Job[] = [];
  /** When this process started, kept in its records with its PID. */
  private readonly ownerStart: Promise<string | undefined> = processStart(process.pid);
  private waiting = 0;
  private stopping = false;
  private sweepTimer?: NodeJS.Timeout;

  constructor(opts: { dataDir: string; env?: NodeJS.ProcessEnv; log?: (...args: unknown[]) => void }) {
    this.store = new Store(opts.dataDir);
    this.env = opts.env ?? process.env;
    this.log = opts.log ?? (() => undefined);
    this.home = this.env.HOME || os.homedir();
  }

  // ---- the methods ----

  async run(folderPath: string, input: RunInput, settings: ShellSettings): Promise<RunAnswer> {
    const refuse = () => new PluginError("Remote Control Shell が止まるところなので、実行できません。");
    if (this.stopping) throw refuse();
    const [f, ownerStart] = await Promise.all([this.folder(folderPath), this.ownerStart]);
    // stop() may have begun meanwhile: it ends only the commands it found.
    if (this.stopping) throw refuse();
    const earlier = input.request === undefined ? undefined : f.jobs.find((j) => j.meta.request === input.request);
    if (earlier) return { ...publicJob(earlier.meta), earlier: true };
    let command = input.command;
    let cwd = f.cwd;
    if (input.again !== undefined) {
      const before = f.find(input.again);
      if (!before) throw new PluginError("この記録は見つかりません。");
      command = before.meta.command;
      cwd = before.meta.cwd;
    }
    if (!command || !command.trim()) throw new PluginError("コマンドを入れてください。");
    if (f.running >= MAX_RUNNING_PER_FOLDER) {
      throw new PluginError(`このフォルダーでは、すでに${MAX_RUNNING_PER_FOLDER}つのコマンドが動いています。ほかのコマンドを止めてから実行してください。`);
    }
    if (this.runningCount() >= MAX_RUNNING) {
      throw new PluginError(`この working server では、すでに${MAX_RUNNING}のコマンドが動いています。ほかのコマンドを止めてから実行してください。`);
    }
    let note: string | undefined;
    if (!isDir(cwd)) {
      if (!isDir(f.path)) throw new PluginError("セッションのフォルダーがありません。");
      note = `作業フォルダー ${cwd} がないので、セッションのフォルダーで実行しました。`;
      cwd = f.path;
      if (input.again === undefined) {
        f.cwd = f.path;
        void f.write(() => this.store.writeFolder(f.key, { path: f.path, cwd: f.path }), this.log);
      }
    }

    const id = newId();
    const job = new Job({
      id,
      command,
      cwd,
      startedAt: Date.now(),
      state: "running",
      ...(note ? { note } : {}),
      size: 0,
      dropped: 0,
      lines: 0,
      owner: process.pid,
      ...(ownerStart ? { ownerStart } : {}),
      ...(input.request !== undefined ? { request: input.request } : {}),
      logFrom: 0,
    }, true);
    job.out = new OutputBuffer(settings.maxOutput);
    f.jobs.push(job);
    f.lastStarted = id;
    this.prune(f, settings.keepJobs);

    const shell = pickShell(settings.shell, this.env.SHELL, isFile);
    let child: ChildProcess;
    try {
      child = spawn(shell, shellArgs(settings.startup, this.store.cwdFile(f.key, id), command), {
        cwd,
        env: shellEnv(this.env, { cwd, ...(input.cols !== undefined ? { cols: input.cols } : {}) }),
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
    } catch (e) {
      this.end(f, job, { error: `起動できませんでした：${e instanceof Error ? e.message : String(e)}` });
      f.bump();
      return publicJob(job.meta);
    }
    job.child = child;
    const pgid = child.pid;
    if (pgid !== undefined) job.meta.pgid = pgid;
    const out = new StringDecoder("utf8");
    const err = new StringDecoder("utf8");
    child.stdout?.on("data", (b: Buffer) => this.received(f, job, out.write(b)));
    child.stderr?.on("data", (b: Buffer) => this.received(f, job, err.write(b)));
    child.on("error", (e: NodeJS.ErrnoException) => {
      this.end(f, job, { error: e.code === "ENOENT" ? `シェル（${shell}）が見つかりません。` : `起動できませんでした：${e.message}` });
    });
    child.on("close", (code, signal) => {
      this.received(f, job, out.end() + err.end());
      this.end(f, job, { code, signal });
    });
    void f.write(async () => {
      const pgidStart = await processStart(pgid);
      if (pgidStart) job.meta.pgidStart = pgidStart;
      await this.store.writeJob(f.key, job.meta);
    }, this.log);
    f.bump();
    return publicJob(job.meta);
  }

  /**
   * Sends SIGINT (as Ctrl+C does) or SIGKILL to a running command's process group. One another process of the plugin
   * runs gets it only while its PID still names the shell that was started.
   */
  async signal(folderPath: string, id: string, which: "INT" | "KILL"): Promise<ShellJob> {
    const f = await this.folder(folderPath);
    const job = f.find(id);
    if (!job) throw new PluginError("この記録は見つかりません。");
    const signal: NodeJS.Signals = which === "KILL" ? "SIGKILL" : "SIGINT";
    if (job.running && job.mine) {
      job.sent = signal;
      if (!killGroup(job.meta.pgid, signal)) job.child?.kill(signal);
    } else if (job.running) {
      await this.settleForeign(f);
      if (job.running) {
        if (!(await sameProcess(job.meta.pgid, job.meta.pgidStart))) {
          throw new PluginError("このコマンドのプロセスが、起動したときと同じものだと確かめられないため、止める合図を送りませんでした。");
        }
        killGroup(job.meta.pgid, signal);
      }
    }
    return publicJob(job.meta);
  }

  /**
   * Moves the working folder to `dir` (the session folder, or a repository gasho-daemon found in it). A command that is
   * still running no longer moves it when it ends.
   */
  async chdir(folderPath: string, dir: string): Promise<{ cwd: string }> {
    const f = await this.folder(folderPath);
    if (!isDir(dir)) throw new PluginError("このフォルダーはありません。");
    f.cwd = dir;
    f.lastStarted = undefined;
    await f.write(() => this.store.writeFolder(f.key, { path: f.path, cwd: dir }), this.log);
    f.bump();
    return { cwd: dir };
  }

  /** Removes one record, or every record of a command that has ended. */
  async clear(folderPath: string, id: string | undefined): Promise<{ removed: number }> {
    const f = await this.folder(folderPath);
    const gone = id === undefined ? f.jobs.filter((j) => !j.running) : f.jobs.filter((j) => j.meta.id === id);
    if (id !== undefined && gone.length === 0) throw new PluginError("この記録は見つかりません。");
    if (gone.some((j) => j.running)) throw new PluginError("実行中のコマンドの記録は消せません。止めてから消してください。");
    if (gone.length === 0) return { removed: 0 };
    f.jobs = f.jobs.filter((j) => !gone.includes(j));
    for (const j of gone) this.forget(j);
    await f.write(() => Promise.all(gone.map((j) => this.store.removeJob(f.key, j.meta.id))), this.log);
    f.bump();
    return { removed: gone.length };
  }

  /**
   * The folder's records, and the output after `offsets` (per record), once there is something the caller has not seen:
   * the list changed since `since`, or a record has output past its offset. Waits up to `waitMs` for that.
   */
  async watch(folderPath: string, input: WatchInput, signal?: AbortSignal): Promise<ShellView> {
    const f = await this.folder(folderPath);
    const ready = () => this.stopping || input.since !== f.version || behind(f, input.offsets);
    let busy = false;
    if (!ready() && input.waitMs > 0) {
      if (this.waiting >= MAX_WAITING) busy = true;
      else {
        this.waiting++;
        try {
          if (await f.wait(ready, input.waitMs, signal)) await sleep(BATCH_MS);
        } finally {
          this.waiting--;
        }
      }
    }
    return this.view(f, input.offsets, busy);
  }

  /** A stretch of a record's output ("すべて表示", "前を読む"). */
  async output(folderPath: string, id: string, from: number, limit: number): Promise<OutputAnswer> {
    const f = await this.folder(folderPath);
    const job = f.find(id);
    if (!job) throw new PluginError("この記録は見つかりません。");
    const out = await this.outputOf(f, job);
    return { ...out.slice(from, Math.min(limit, OUTPUT_BUDGET)), size: out.size, dropped: out.dropped };
  }

  async status(folderPath: string): Promise<StatusAnswer> {
    return { running: (await this.folder(folderPath)).running };
  }

  /**
   * The plugin stops (README.md「プラグインが止まるとき」): its running commands get SIGTERM, then SIGKILL, and are
   * recorded as ended with the plugin. gasho-daemon waits 5 s for this.
   */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
    const folders = [...this.loaded.values()];
    const mine = folders.flatMap((f) => f.jobs.filter((j) => j.running && j.mine).map((j) => ({ f, j })));
    for (const { j } of mine) {
      j.lost = true;
      killGroup(j.meta.pgid, "SIGTERM");
    }
    const allEnded = () => Promise.all(mine.map(({ j }) => j.ended));
    await Promise.race([allEnded(), sleep(TERM_MS)]);
    for (const { j } of mine) if (j.running) killGroup(j.meta.pgid, "SIGKILL");
    await Promise.race([allEnded(), sleep(1000)]);
    // Gone without a word: recorded as they are.
    for (const { f, j } of mine) if (j.running) this.end(f, j, { signal: "SIGKILL" });
    await Promise.all(folders.map((f) => f.idle()));
    for (const f of folders) {
      if (f.foreignTimer) clearInterval(f.foreignTimer);
      f.foreignTimer = undefined;
      f.changed();
    }
  }

  /** Looks for the records of session folders that have gone now, and every few hours until stop(). */
  tidy(): void {
    void this.sweep();
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.sweepTimer.unref();
  }

  /**
   * Removes the records of session folders that are no longer there (a worktree removed, …) GONE_KEEP_MS after one was
   * first found gone, unless a command of theirs runs (README.md「記録の保存」). When it was first found gone is kept
   * with the folder, and dropped once it is there again, so that one out of sight for a while (a disk not plugged in)
   * keeps its records. Resolves to how many went.
   */
  async sweep(now = Date.now()): Promise<number> {
    let removed = 0;
    for (const key of await this.store.keys()) {
      if (this.stopping) break;
      const loading = this.folders.get(key);
      const f = this.loaded.get(key);
      if (loading && !f) continue;
      const saved = await this.store.readFolder(key);
      const path = f ? f.path : saved?.path;
      if (path === undefined) continue;
      const there = isDir(path);
      const gone = saved?.gone;
      if (there === (gone !== undefined)) {
        const marked = { path, cwd: f ? f.cwd : (saved?.cwd ?? path), ...(there ? {} : { gone: now }) };
        const write = () => this.store.writeFolder(key, marked);
        await (f ? f.write(write, this.log) : write().catch((e: unknown) => this.log("could not write", e)));
        continue;
      }
      if (gone === undefined || now - gone < GONE_KEEP_MS) continue;
      // Looked at again: a call may have come for the folder meanwhile.
      if (this.stopping || this.folders.get(key) !== loading || (f && (f.running > 0 || f.settling))) continue;
      if (f) {
        this.folders.delete(key);
        this.loaded.delete(key);
        if (f.foreignTimer) clearInterval(f.foreignTimer);
        for (const j of f.jobs) this.forget(j);
        await f.idle();
      }
      await this.store.removeFolder(key).then(
        () => {
          removed++;
          this.log("removed the records of a folder that has gone:", path);
        },
        (e: unknown) => this.log("could not remove the records of", path, e),
      );
    }
    return removed;
  }

  /** Settles once what has been written so far is on disk, and the records that ended are in the list (for tests). */
  async idle(): Promise<void> {
    await Promise.all([...this.loaded.values()].map((f) => f.idle()));
  }

  // ---- inside ----

  private runningCount(): number {
    let n = 0;
    for (const f of this.loaded.values()) n += f.running;
    return n;
  }

  private folder(path: string): Promise<Folder> {
    const key = folderKey(path);
    let f = this.folders.get(key);
    if (!f) {
      f = this.load(key, path);
      this.folders.set(key, f);
      f.catch(() => this.folders.delete(key));
    }
    return f;
  }

  private async load(key: string, path: string): Promise<Folder> {
    await this.store.ensure(key);
    const saved = await this.store.readFolder(key);
    const same = saved?.path === path;
    const f = new Folder(key, path, same && saved ? saved.cwd : path);
    if (!same) await this.store.writeFolder(key, { path, cwd: path });
    f.jobs = (await this.store.readJobs(key)).map((m) => new Job(m));
    this.loaded.set(key, f);
    await this.settleForeign(f);
    return f;
  }

  /** Output that came: kept, written to its file a little later, and waiting watches look again. */
  private received(f: Folder, job: Job, text: string): void {
    const out = job.out;
    if (!text || !out || !job.running) return;
    out.append(text);
    job.meta.size = out.size;
    job.meta.dropped = out.dropped;
    job.meta.lines = out.lines;
    if (!job.flushTimer) {
      job.flushTimer = setTimeout(() => {
        job.flushTimer = undefined;
        void this.flush(f, job);
      }, FLUSH_MS);
      job.flushTimer.unref();
    }
    f.changed();
  }

  /**
   * Writes the output that came since the last time to the command's file (appending), and its record. Once the file
   * holds twice the limit, or output it never wrote has been dropped, it is written again with what is kept.
   */
  private flush(f: Folder, job: Job): Promise<void> {
    return f.write(async () => {
      const out = job.out;
      if (!out || !job.running) return;
      const size = out.size;
      const record: StoredJob = { ...job.meta, size, dropped: out.dropped, lines: out.lines };
      if (job.flushedTo < out.dropped || size - job.meta.logFrom > 2 * out.max) {
        const text = out.text;
        record.logFrom = out.dropped;
        await this.store.writeLog(f.key, job.meta.id, text);
        job.meta.logFrom = record.logFrom;
      } else if (size > job.flushedTo) {
        await this.store.appendLog(f.key, job.meta.id, out.slice(job.flushedTo, size - job.flushedTo).text);
      }
      job.flushedTo = size;
      if (job.running) await this.store.writeJob(f.key, record);
    }, this.log);
  }

  /** A command ended (or could not start): its record, its output file, and, if it was started last, the working folder. */
  private end(f: Folder, job: Job, how: { code?: number | null; signal?: NodeJS.Signals | null; error?: string }): void {
    const m = job.meta;
    if (m.state !== "running") return;
    m.endedAt = Date.now();
    if (how.error !== undefined) {
      m.state = "failed";
      m.note = how.error;
    } else if (job.lost) {
      m.state = "lost";
    } else if (how.signal) {
      m.state = "stopped";
      m.signal = how.signal;
    } else if (job.sent && how.code === 128 + (os.constants.signals[job.sent] ?? 0)) {
      // The shell ends with the command's status (shell.ts): 128 + the signal's number when the signal ended it.
      m.state = "stopped";
      m.signal = job.sent;
    } else {
      m.state = "exited";
      m.exitCode = how.code ?? 0;
    }
    if (job.flushTimer) clearTimeout(job.flushTimer);
    job.flushTimer = undefined;
    job.child = undefined;
    const out = job.out;
    if (out) {
      out.final();
      m.size = out.size;
      m.dropped = out.dropped;
      m.lines = out.lines;
      this.remember(job);
    }
    const carry = f.lastStarted === m.id && m.state !== "failed";
    const cwdFile = this.store.cwdFile(f.key, m.id);
    void f
      .write(async () => {
        if (carry && f.lastStarted === m.id) {
          // Only a command that moved moves the working folder: one run again in the folder it ran in does not.
          const next = (await fs.readFile(cwdFile, "utf8").catch(() => "")).replace(/\n$/, "");
          if (next && next !== m.cwd && next !== f.cwd && isDir(next)) {
            f.cwd = next;
            await this.store.writeFolder(f.key, { path: f.path, cwd: next });
          }
        }
        await fs.rm(cwdFile, { force: true });
        if (out) {
          await this.store.writeLog(f.key, m.id, out.text);
          m.logFrom = out.dropped;
          job.flushedTo = out.size;
        }
        await this.store.writeJob(f.key, m);
      }, this.log)
      .then(() => {
        f.bump();
        job.done();
      });
  }

  /** Drops the oldest records of ended commands beyond `keep`. */
  private prune(f: Folder, keep: number): void {
    let extra = f.jobs.length - keep;
    if (extra <= 0) return;
    const gone: Job[] = [];
    for (const j of f.jobs) {
      if (extra <= 0) break;
      if (j.running) continue;
      gone.push(j);
      extra--;
    }
    if (gone.length === 0) return;
    f.jobs = f.jobs.filter((j) => !gone.includes(j));
    for (const j of gone) this.forget(j);
    void f.write(() => Promise.all(gone.map((j) => this.store.removeJob(f.key, j.meta.id))), this.log);
  }

  /** A record's output: in memory, or read from its file (kept for a while once its command has ended). */
  private async outputOf(f: Folder, job: Job): Promise<OutputBuffer> {
    if (job.out && (job.child || !job.running)) {
      if (!job.running) this.remember(job);
      return job.out;
    }
    const text = await this.store.readLog(f.key, job.meta.id);
    const out = new OutputBuffer(Number.MAX_SAFE_INTEGER, { text, dropped: job.meta.logFrom, lines: job.meta.lines });
    if (!job.running) {
      job.out = out;
      this.remember(job);
    }
    return out;
  }

  private remember(job: Job): void {
    this.forget(job);
    this.cached.push(job);
    while (this.cached.length > CACHED_OUTPUTS) {
      const old = this.cached.shift();
      if (old && !old.running) old.out = undefined;
    }
  }

  private forget(job: Job): void {
    const i = this.cached.indexOf(job);
    if (i >= 0) this.cached.splice(i, 1);
  }

  private async view(f: Folder, offsets: Record<string, number>, busy: boolean): Promise<ShellView> {
    const version = f.version;
    const cwd = f.cwd;
    const jobs = f.jobs.map((j) => publicJob(j.meta));
    const output: Record<string, OutputPiece> = {};
    let budget = WATCH_BUDGET;
    for (const [id, at] of Object.entries(offsets)) {
      if (budget <= 0) break;
      const job = f.find(id);
      if (!job || job.meta.size <= at) continue;
      const piece = (await this.outputOf(f, job)).slice(at, budget);
      if (piece.text) {
        output[id] = piece;
        budget -= piece.text.length;
      }
    }
    return { version, folder: f.path, cwd, home: this.home, now: Date.now(), jobs, output, ...(busy ? { busy: true } : {}) };
  }

  /**
   * Records another process of the plugin runs (the old version, during a hot reload): shown as that process writes
   * them. Once it has gone, any of them still running are ended here, with the output that reached their file; their
   * group gets SIGKILL only while its PID still names the shell that was started, and nothing when that cannot be told
   * (README.md「プラグインが止まるとき」).
   */
  private async settleForeign(f: Folder): Promise<void> {
    if (this.stopping || f.settling) return;
    f.settling = true;
    let changed = false;
    try {
      for (const job of f.jobs) {
        if (!job.running || job.mine) continue;
        const disk = await this.store.readJob(f.key, job.meta.id);
        if (disk && (disk.state !== job.meta.state || disk.size !== job.meta.size || disk.logFrom !== job.meta.logFrom)) {
          job.meta = disk;
          job.out = undefined;
          changed = true;
        }
        if (!job.running || (await sameProcess(job.meta.owner, job.meta.ownerStart))) continue;
        if (await sameProcess(job.meta.pgid, job.meta.pgidStart)) killGroup(job.meta.pgid, "SIGKILL");
        const text = await this.store.readLog(f.key, job.meta.id);
        const size = job.meta.logFrom + text.length;
        job.meta = { ...job.meta, state: "lost", endedAt: Date.now(), size, dropped: job.meta.logFrom };
        job.done();
        const record = job.meta;
        await f.write(() => this.store.writeJob(f.key, record), this.log);
        changed = true;
      }
    } finally {
      f.settling = false;
    }
    const foreign = f.jobs.some((j) => j.running && !j.mine);
    if (foreign && !f.foreignTimer) {
      f.foreignTimer = setInterval(() => void this.settleForeign(f), FOREIGN_CHECK_MS);
      f.foreignTimer.unref();
    } else if (!foreign && f.foreignTimer) {
      clearInterval(f.foreignTimer);
      f.foreignTimer = undefined;
    }
    if (changed) f.bump();
  }
}

/** A record in `offsets` has output past its offset. */
function behind(f: Folder, offsets: Record<string, number>): boolean {
  for (const [id, at] of Object.entries(offsets)) {
    const job = f.find(id);
    if (job && job.meta.size > at) return true;
  }
  return false;
}
