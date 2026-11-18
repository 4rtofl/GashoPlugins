// The review worktrees to remove once what was asked of their Agent is done (cleanup.ts): kept in the plugin's own
// folder on the working server (ctx.dataDir), so that every browser sees them and they outlast the page. A browser
// claims one before it removes it, so that two pages open at the same time do not both try.
import fs from "node:fs/promises";
import path from "node:path";
import type { CleanupKind } from "../cleanup.ts";

export interface CleanupEntry {
  /** OWNER/REPO, as GitHub named it when it was asked. */
  repo: string;
  number: number;
  kind: CleanupKind;
  /** The head whose verdict it was asked of (the mark's sha). */
  sha?: string;
  /** When it was asked (ms since the epoch). */
  at: number;
  /** Why it could not be removed: not tried again. */
  problem?: string;
}

/** A claim lasts this long: a page that claimed and went away leaves it to the others after that. */
export const CLAIM_MS = 2 * 60_000;
/** Entries kept, at most (the oldest go first). */
export const MAX_CLEANUPS = 200;

const keyOf = (repo: string, number: number): string => `${repo.toLowerCase()}#${number}`;

const isEntry = (v: unknown): v is CleanupEntry => {
  const e = v as Partial<CleanupEntry> | null;
  return (
    typeof e === "object" &&
    e !== null &&
    typeof e.repo === "string" &&
    typeof e.number === "number" &&
    (e.kind === "merge" || e.kind === "sendBack") &&
    (e.sha === undefined || typeof e.sha === "string") &&
    typeof e.at === "number" &&
    (e.problem === undefined || typeof e.problem === "string")
  );
};

export class Cleanups {
  private file: string;
  private log: (...args: unknown[]) => void;
  private now: () => number;
  private entries = new Map<string, CleanupEntry>();
  private claims = new Map<string, number>();
  private loaded: Promise<void> | undefined;
  /** Writes one after another, so that the file holds the last. */
  private writing: Promise<void> = Promise.resolve();

  constructor(deps: { file: string; log: (...args: unknown[]) => void; now?: () => number }) {
    this.file = deps.file;
    this.log = deps.log;
    this.now = deps.now ?? Date.now;
  }

  load(): Promise<void> {
    this.loaded ??= fs.readFile(this.file, "utf8").then(
      (raw) => {
        let v: { cleanups?: unknown } | null;
        try {
          v = JSON.parse(raw) as { cleanups?: unknown } | null;
        } catch (e) {
          // Starts with none: the next one asked writes the file anew.
          this.log("github-review: the file of the worktrees to clean up is broken; starting with none", e);
          return;
        }
        for (const e of Array.isArray(v?.cleanups) ? v.cleanups : []) if (isEntry(e)) this.entries.set(keyOf(e.repo, e.number), e);
      },
      (e: unknown) => {
        if ((e as { code?: unknown }).code !== "ENOENT") this.log("github-review: could not read the worktrees to clean up", e);
      },
    );
    return this.loaded;
  }

  private save(): Promise<void> {
    const body = `${JSON.stringify({ cleanups: [...this.entries.values()] }, null, 2)}\n`;
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, body);
      await fs.rename(tmp, this.file);
    });
    return this.writing;
  }

  async get(repo: string, number: number): Promise<CleanupEntry | undefined> {
    await this.load();
    return this.entries.get(keyOf(repo, number));
  }

  /** All of them, the oldest first. */
  async all(): Promise<CleanupEntry[]> {
    await this.load();
    return [...this.entries.values()];
  }

  /**
   * Remove the review worktree of `repo`#`number` once `kind` is done, asked of the verdict on `sha`; asked again, it
   * starts over.
   */
  async follow(repo: string, number: number, kind: CleanupKind, sha?: string): Promise<CleanupEntry> {
    await this.load();
    const key = keyOf(repo, number);
    const e: CleanupEntry = { repo, number, kind, ...(sha ? { sha } : {}), at: this.now() };
    this.entries.delete(key);
    this.entries.set(key, e);
    this.claims.delete(key);
    while (this.entries.size > MAX_CLEANUPS) this.entries.delete(this.entries.keys().next().value as string);
    await this.save();
    return e;
  }

  /** Not to be removed (it was, or the person no longer wants it to be). */
  async forget(repo: string, number: number): Promise<void> {
    await this.load();
    const key = keyOf(repo, number);
    this.claims.delete(key);
    if (this.entries.delete(key)) await this.save();
  }

  /** It could not be removed: why, on its row, and it is not tried again. */
  async fail(repo: string, number: number, problem: string): Promise<void> {
    await this.load();
    const key = keyOf(repo, number);
    this.claims.delete(key);
    const e = this.entries.get(key);
    if (!e) return;
    this.entries.set(key, { ...e, problem });
    await this.save();
  }

  /** A page is about to remove it: true for the first to ask, until it is done or the claim runs out. */
  async claim(repo: string, number: number): Promise<boolean> {
    await this.load();
    const key = keyOf(repo, number);
    const e = this.entries.get(key);
    if (!e || e.problem) return false;
    const at = this.claims.get(key);
    if (at !== undefined && this.now() - at < CLAIM_MS) return false;
    this.claims.set(key, this.now());
    return true;
  }

  /** Forgets those `gone` says have no review worktree any more (removed by hand, say). */
  async prune(gone: (e: CleanupEntry) => boolean): Promise<void> {
    await this.load();
    let changed = false;
    for (const [key, e] of this.entries) {
      if (!gone(e)) continue;
      this.entries.delete(key);
      this.claims.delete(key);
      changed = true;
    }
    if (changed) await this.save();
  }
}
