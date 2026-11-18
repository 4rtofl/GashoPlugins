// What github-implement keeps per worktree on a working server (in its own folder, ctx.dataDir): the numbers added to
// it by hand, and when Gasho last showed it. The worktrees shown recently are the ones read again in the background.
import fs from "node:fs/promises";
import path from "node:path";

export interface KeptWorktree {
  /** owner/name on GitHub. */
  repo: string;
  branch?: string;
  /** Added by hand, in the order they were added. */
  added: number[];
  /** When Gasho last showed the worktree's tabs (ms since the epoch). */
  seenAt: number;
}

/** Shown worktrees are written down at most this often, so that every look at a tab does not write the file. */
const SEEN_WRITE_MS = 10 * 60_000;
/** Worktrees kept, at most: the ones shown longest ago go first. */
const KEPT_MAX = 500;

export class Store {
  private worktrees = new Map<string, KeptWorktree>();
  private loaded?: Promise<void>;
  private writing: Promise<void> = Promise.resolve();
  private written = new Map<string, number>();
  private readonly file: string;
  private readonly log: (...args: unknown[]) => void;

  constructor(file: string, log: (...args: unknown[]) => void) {
    this.file = file;
    this.log = log;
  }

  /** A file that is not what this writes starts it empty, and the next write replaces it. */
  load(): Promise<void> {
    this.loaded ??= readKept(this.file, this.log).then((data) => {
      const worktrees = (data as { worktrees?: Record<string, KeptWorktree> } | null)?.worktrees;
      for (const [key, w] of Object.entries(typeof worktrees === "object" && worktrees !== null ? worktrees : {})) {
        if (typeof w?.repo !== "string" || !Array.isArray(w.added)) continue;
        this.worktrees.set(key, { repo: w.repo, ...(typeof w.branch === "string" ? { branch: w.branch } : {}), added: w.added.filter((n) => Number.isInteger(n)), seenAt: Number(w.seenAt) || 0 });
        this.written.set(key, Number(w.seenAt) || 0);
      }
    });
    return this.loaded;
  }

  get(worktree: string): KeptWorktree | undefined {
    return this.worktrees.get(worktree);
  }

  /** The worktrees shown since `since`, the latest first. */
  shownSince(since: number): [string, KeptWorktree][] {
    return [...this.worktrees].filter(([, w]) => w.seenAt >= since).sort((a, b) => b[1].seenAt - a[1].seenAt);
  }

  /** Gasho shows the worktree's tabs now: what it is, as the screen says. */
  async seen(worktree: string, repo: string, branch: string | undefined, now: number): Promise<KeptWorktree> {
    await this.load();
    const old = this.worktrees.get(worktree);
    const w: KeptWorktree = { repo, ...(branch ? { branch } : {}), added: old && old.repo === repo ? old.added : [], seenAt: now };
    this.worktrees.set(worktree, w);
    const changed = !old || old.repo !== repo || old.branch !== branch;
    if (changed || now - (this.written.get(worktree) ?? 0) >= SEEN_WRITE_MS) await this.save();
    return w;
  }

  async add(worktree: string, repo: string, number: number, now: number): Promise<void> {
    await this.load();
    const old = this.worktrees.get(worktree);
    const added = old && old.repo === repo ? old.added : [];
    this.worktrees.set(worktree, { repo, ...(old?.branch ? { branch: old.branch } : {}), added: added.includes(number) ? added : [...added, number], seenAt: now });
    await this.save();
  }

  async remove(worktree: string, number: number): Promise<void> {
    await this.load();
    const old = this.worktrees.get(worktree);
    if (!old || !old.added.includes(number)) return;
    this.worktrees.set(worktree, { ...old, added: old.added.filter((n) => n !== number) });
    await this.save();
  }

  /** Writes the file whole (to a new file, then renamed over it), one write at a time. */
  private save(): Promise<void> {
    const next = this.writing.then(async () => {
      const kept = [...this.worktrees].sort((a, b) => b[1].seenAt - a[1].seenAt).slice(0, KEPT_MAX);
      this.worktrees = new Map(kept);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify({ worktrees: Object.fromEntries(kept) }, null, 2)}\n`);
      await fs.rename(tmp, this.file);
      for (const [key, w] of kept) this.written.set(key, w.seenAt);
    });
    this.writing = next.catch(() => undefined);
    return next;
  }
}

/**
 * The JSON of a file of what github-implement keeps; undefined when there is none yet, or when it cannot be read or is
 * not JSON (said in the log): a load that failed would fail every call until the file was removed by hand.
 */
export async function readKept(file: string, log: (...args: unknown[]) => void): Promise<unknown> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as { code?: unknown })?.code !== "ENOENT") log(`could not read ${file}; starting without it`, e);
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    log(`${file} is not JSON; starting without it, and the next write replaces it`, e);
    return undefined;
  }
}
