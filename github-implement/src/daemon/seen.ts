// What github-implement keeps on a working server (in its own folder, ctx.dataDir) of what each item's screen showed:
// its marks (src/news.ts), by owner/name#number, so that the item's worktree tab counts only what came after them.
import fs from "node:fs/promises";
import path from "node:path";
import { laterMarks, type SeenMarks } from "../news.ts";

interface Kept {
  marks: SeenMarks;
  /** When they last changed (ms since the epoch). */
  at: number;
}

/** Items kept, at most: those whose marks changed longest ago go first. */
const KEPT_MAX = 2000;

export class SeenStore {
  readonly file: string;
  private items = new Map<string, Kept>();
  private loaded?: Promise<void>;
  private writing: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.file = file;
  }

  private load(): Promise<void> {
    this.loaded ??= fs.readFile(this.file, "utf8").then(
      (text) => {
        const data = JSON.parse(text) as { items?: Record<string, Kept> };
        for (const [key, k] of Object.entries(data.items ?? {})) {
          if (typeof k?.marks === "object" && k.marks !== null) this.items.set(key, { marks: laterMarks(k.marks, {}), at: Number(k.at) || 0 });
        }
      },
      () => undefined,
    );
    return this.loaded;
  }

  async get(key: string): Promise<SeenMarks | undefined> {
    await this.load();
    return this.items.get(key)?.marks;
  }

  /** Takes the later of each mark, and writes the file when one moved. */
  async mark(key: string, marks: SeenMarks, now: number): Promise<void> {
    await this.load();
    const old = this.items.get(key);
    const next = old ? laterMarks(old.marks, marks) : laterMarks(marks, {});
    if (old && JSON.stringify(next) === JSON.stringify(old.marks)) return;
    this.items.set(key, { marks: next, at: now });
    await this.save();
  }

  /** Writes the file whole (to a new file, then renamed over it), one write at a time. */
  private save(): Promise<void> {
    const next = this.writing.then(async () => {
      const kept = [...this.items].sort((a, b) => b[1].at - a[1].at).slice(0, KEPT_MAX);
      this.items = new Map(kept);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify({ items: Object.fromEntries(kept) }, null, 2)}\n`);
      await fs.rename(tmp, this.file);
    });
    this.writing = next.catch(() => undefined);
    return next;
  }
}

let store: SeenStore | undefined;

/** The store of the plugin's folder on this working server. */
export function seenStore(dataDir: string): SeenStore {
  const file = path.join(dataDir, "seen.json");
  if (store?.file !== file) store = new SeenStore(file);
  return store;
}

/** An item's key in the store. */
export const seenKey = (repo: string, number: number): string => `${repo}#${number}`;
