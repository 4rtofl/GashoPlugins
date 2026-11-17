// What the panel knows of a session folder's commands, and how each answer of `watch` changes it (README.md「出力は変化を
// 待つ呼び出しで届ける」). For each command it keeps a window of its output: a stretch that ends where it has read to.
// Pure (types only are imported), so that it can be tested.
import type { OutputPiece, ShellJob, ShellView } from "../types.ts";

/** A stretch of a command's output: `text` starts `from` characters after the start of its output. */
export interface OutputWindow {
  from: number;
  text: string;
}

export interface ShellState {
  /** An answer has come. */
  loaded: boolean;
  version?: string;
  folder?: string;
  cwd?: string;
  home?: string;
  /** The working server's clock minus this browser's (ms). */
  skew: number;
  /** Oldest first. */
  jobs: ShellJob[];
  windows: Record<string, OutputWindow>;
  error?: string;
}

export const EMPTY_STATE: ShellState = { loaded: false, skew: 0, jobs: [], windows: {} };

/** Output of a running command kept here (characters): it grows; older output is read once it has ended. */
export const RUNNING_WINDOW = 512 * 1024;
/** What is read first of a command: the end of a running one, and the end of an ended one (for its last lines). */
export const FIRST_RUNNING = 64 * 1024;
export const FIRST_ENDED = 4 * 1024;
/** Commands whose output is followed: the newest ones, and older ones while they run. */
export const FOLLOWED = 50;

export const windowEnd = (w: OutputWindow): number => w.from + w.text.length;

/** Where each command's output is read from next. Ended commands whose output is all here are left out. */
export function offsetsFor(s: ShellState): Record<string, number> {
  const offsets: Record<string, number> = {};
  const newest = s.jobs.length - FOLLOWED;
  for (const [i, job] of s.jobs.entries()) {
    const running = job.state === "running";
    // The setting keepJobs keeps up to 500 records; a command that runs is followed however many came after it.
    if (i < newest && !running) continue;
    const w = s.windows[job.id];
    if (w) {
      if (running || windowEnd(w) < job.size) offsets[job.id] = windowEnd(w);
      continue;
    }
    if (job.size === 0) {
      if (running) offsets[job.id] = 0;
      continue;
    }
    offsets[job.id] = Math.max(job.dropped, job.size - (running ? FIRST_RUNNING : FIRST_ENDED));
  }
  return offsets;
}

const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** The end of a window, at most `max` characters, starting at a line when one starts near the cut. */
export function trimWindow(w: OutputWindow, max: number): OutputWindow {
  if (w.text.length <= max) return w;
  let cut = w.text.length - max;
  const line = w.text.indexOf("\n", cut);
  if (line >= 0 && line - cut < 4096) cut = line + 1;
  if (cut < w.text.length && isLow(w.text.charCodeAt(cut))) cut++;
  return { from: w.from + cut, text: w.text.slice(cut) };
}

/**
 * A window with a piece of output in it: a piece that starts inside the window (or at its end) continues it; one that
 * ends inside it (or at its start) comes before it; one apart from it takes its place.
 */
export function joinPiece(w: OutputWindow | undefined, p: OutputPiece): OutputWindow {
  if (!w) return { from: p.from, text: p.text };
  const pEnd = p.from + p.text.length;
  const wEnd = windowEnd(w);
  if (p.from >= w.from && p.from <= wEnd) {
    return { from: w.from, text: w.text.slice(0, p.from - w.from) + p.text + (pEnd < wEnd ? w.text.slice(pEnd - w.from) : "") };
  }
  if (p.from < w.from && pEnd >= w.from) return { from: p.from, text: p.text + (wEnd > pEnd ? w.text.slice(pEnd - w.from) : "") };
  return { from: p.from, text: p.text };
}

/** The state after an answer of `watch` (`now`: this browser's clock when it came). */
export function mergeView(s: ShellState, v: ShellView, now: number): ShellState {
  const ids = new Set(v.jobs.map((j) => j.id));
  const windows: Record<string, OutputWindow> = {};
  for (const [id, w] of Object.entries(s.windows)) if (ids.has(id)) windows[id] = w;
  for (const [id, piece] of Object.entries(v.output)) if (ids.has(id)) windows[id] = joinPiece(windows[id], piece);
  for (const job of v.jobs) {
    const w = windows[job.id];
    if (w && job.state === "running") windows[job.id] = trimWindow(w, RUNNING_WINDOW);
  }
  return { loaded: true, version: v.version, folder: v.folder, cwd: v.cwd, home: v.home, skew: v.now - now, jobs: v.jobs, windows };
}

/** The state with a command that has just started (the answer of `run`), before `watch` brings it. */
export function addJob(s: ShellState, job: ShellJob): ShellState {
  if (s.jobs.some((j) => j.id === job.id)) return s;
  return { ...s, jobs: [...s.jobs, job] };
}
