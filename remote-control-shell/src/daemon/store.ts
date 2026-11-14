// What Remote Control Shell keeps on the working server, in the plugin's own folder (ctx.dataDir), per session folder
// (README.md「記録の保存」):
//
//   folders/<the first 16 hex digits of the SHA-256 of the session folder's path>/
//     folder.json      the session folder's path, and the working folder
//     <id>.json        a record: the command, where and when it ran, how it ended
//     <id>.log         its output, from `logFrom` to `size`
//     <id>.cwd         while it runs: where the shell's EXIT trap writes the folder it ended in
//
// Only the person running gasho-daemon may read them (700 and 600).
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { JOB_ID, type JobState, type ShellJob } from "../types.ts";

/** A record as kept: the job, the plugin process that runs it, its process group, and where its output file starts. */
export interface StoredJob extends ShellJob {
  owner: number;
  pgid?: number;
  /** The output file holds the output from this position (characters) to `size`. */
  logFrom: number;
}

export interface StoredFolder {
  path: string;
  cwd: string;
}

const STATES = new Set<JobState>(["running", "exited", "stopped", "failed", "lost"]);

export const folderKey = (folder: string): string => createHash("sha256").update(folder).digest("hex").slice(0, 16);

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A record read back, or undefined when it is not one. */
export function storedJob(raw: unknown): StoredJob | undefined {
  const j = raw as Partial<StoredJob> | null;
  if (!j || typeof j.id !== "string" || !JOB_ID.test(j.id) || typeof j.command !== "string" || typeof j.cwd !== "string") return undefined;
  if (!num(j.startedAt) || !STATES.has(j.state as JobState) || !num(j.size) || !num(j.dropped) || !num(j.owner)) return undefined;
  return {
    id: j.id,
    command: j.command,
    cwd: j.cwd,
    startedAt: j.startedAt,
    ...(num(j.endedAt) ? { endedAt: j.endedAt } : {}),
    state: j.state as JobState,
    ...(num(j.exitCode) ? { exitCode: j.exitCode } : {}),
    ...(typeof j.signal === "string" ? { signal: j.signal } : {}),
    ...(typeof j.note === "string" ? { note: j.note } : {}),
    size: j.size,
    dropped: j.dropped,
    lines: num(j.lines) ? j.lines : 0,
    owner: j.owner,
    ...(num(j.pgid) ? { pgid: j.pgid } : {}),
    logFrom: num(j.logFrom) ? j.logFrom : j.dropped,
  };
}

let tmpSeq = 0;

/** Writes a file whole: a reader finds the old one or the new one, never half of one. */
async function writeWhole(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${tmpSeq++}.tmp`;
  try {
    await fs.writeFile(tmp, data, { mode: 0o600 });
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

export class Store {
  readonly root: string;

  constructor(dataDir: string) {
    this.root = path.join(dataDir, "folders");
  }

  dir(key: string): string {
    return path.join(this.root, key);
  }

  cwdFile(key: string, id: string): string {
    return path.join(this.dir(key), `${id}.cwd`);
  }

  async ensure(key: string): Promise<void> {
    await fs.mkdir(this.dir(key), { recursive: true, mode: 0o700 });
  }

  async readFolder(key: string): Promise<StoredFolder | undefined> {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(this.dir(key), "folder.json"), "utf8")) as Partial<StoredFolder> | null;
      return typeof raw?.path === "string" && typeof raw.cwd === "string" ? { path: raw.path, cwd: raw.cwd } : undefined;
    } catch {
      return undefined;
    }
  }

  writeFolder(key: string, folder: StoredFolder): Promise<void> {
    return writeWhole(path.join(this.dir(key), "folder.json"), `${JSON.stringify(folder)}\n`);
  }

  /** The records of a folder, oldest first; anything unreadable is left out. */
  async readJobs(key: string): Promise<StoredJob[]> {
    const names = await fs.readdir(this.dir(key)).catch(() => [] as string[]);
    const jobs = await Promise.all(
      names.filter((n) => n.endsWith(".json") && JOB_ID.test(n.slice(0, -5))).map((n) => this.readJob(key, n.slice(0, -5))),
    );
    return jobs.filter((j): j is StoredJob => j !== undefined).sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  }

  async readJob(key: string, id: string): Promise<StoredJob | undefined> {
    try {
      return storedJob(JSON.parse(await fs.readFile(path.join(this.dir(key), `${id}.json`), "utf8")));
    } catch {
      return undefined;
    }
  }

  writeJob(key: string, job: StoredJob): Promise<void> {
    return writeWhole(path.join(this.dir(key), `${job.id}.json`), `${JSON.stringify(job)}\n`);
  }

  appendLog(key: string, id: string, text: string): Promise<void> {
    return fs.appendFile(path.join(this.dir(key), `${id}.log`), text, { mode: 0o600 });
  }

  writeLog(key: string, id: string, text: string): Promise<void> {
    return writeWhole(path.join(this.dir(key), `${id}.log`), text);
  }

  async readLog(key: string, id: string): Promise<string> {
    try {
      return await fs.readFile(path.join(this.dir(key), `${id}.log`), "utf8");
    } catch {
      return "";
    }
  }

  async removeJob(key: string, id: string): Promise<void> {
    await Promise.all([".json", ".log", ".cwd"].map((ext) => fs.rm(path.join(this.dir(key), `${id}${ext}`), { force: true })));
  }
}
