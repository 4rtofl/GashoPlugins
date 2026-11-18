// What the web part and the daemon part of Remote Control Shell pass to each other (README.md). The daemon part runs
// each command in a shell of its own in the session's folder and keeps its output; the panel follows it with `watch`.

/** How a command is doing: running, ended by itself, stopped by a signal, could not start, or ended with the plugin. */
export type JobState = "running" | "exited" | "stopped" | "failed" | "lost";

/** One command run in a session's folder (its record). */
export interface ShellJob {
  id: string;
  command: string;
  /** The folder it ran in (absolute). */
  cwd: string;
  /** ms since the epoch, by the working server's clock. */
  startedAt: number;
  endedAt?: number;
  state: JobState;
  exitCode?: number;
  /** stopped: the signal ("SIGINT", …). */
  signal?: string;
  /** failed: why. Otherwise a remark, such as the working folder having gone. */
  note?: string;
  /** Characters of output so far, those dropped from its start (beyond the limit), and its lines. */
  size: number;
  dropped: number;
  lines: number;
}

/** A stretch of a command's output: `text` starts `from` characters after the start of the output. */
export interface OutputPiece {
  from: number;
  text: string;
}

/** What `watch` answers: the folder's commands, and the output that came after the positions asked for. */
export interface ShellView {
  /** Changes whenever the list does: a command started or ended, the working folder changed, records went. */
  version: string;
  /** The session's folder, the folder the next command runs in, and the working server's home folder. */
  folder: string;
  cwd: string;
  home: string;
  /** The working server's clock when this was answered (ms). */
  now: number;
  /** Oldest first. */
  jobs: ShellJob[];
  output: Record<string, OutputPiece>;
  /** Too many watches wait already: ask again a little later. */
  busy?: boolean;
}

export interface OutputAnswer extends OutputPiece {
  size: number;
  dropped: number;
}

export interface StatusAnswer {
  running: number;
}

/** Characters of a command, and how long a `watch` may wait for a change (ms). */
export const MAX_COMMAND_CHARS = 16_000;
export const MAX_WAIT_MS = 20_000;
/** A record's id: the time it started (base 36) and 3 random bytes. */
export const JOB_ID = /^[0-9a-z]{6,12}-[0-9a-f]{6}$/;
/** The panel's name for a `run`: 16 random hex digits (it may send the same one again after getting no answer). */
export const RUN_REQUEST = /^[0-9a-f]{16}$/;
