// The sessions a review was sent to, until the review is posted and the page removes them (review-session.ts): kept in
// the plugin's own folder on the working server (ctx.dataDir), as a review outlasts the page. A browser claims one before
// it removes it, so that two pages open at the same time do not both try.
import fs from "node:fs/promises";
import path from "node:path";
import type { TrackedReview } from "../review-session.ts";

export interface SessionRemoval extends TrackedReview {
  sessionId: string;
  /** OWNER/REPO, as GitHub named it when the review was sent. */
  repo: string;
  number: number;
}

/** A claim lasts this long: a page that claimed and went away leaves it to the others after that. */
export const REMOVAL_CLAIM_MS = 2 * 60_000;
/** Entries kept, at most (the oldest go first). */
export const MAX_REMOVALS = 200;
/** A review not posted after this long is not waited for any more: its session stays. */
export const REMOVAL_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

const isEntry = (v: unknown): v is SessionRemoval => {
  const e = v as Partial<SessionRemoval> | null;
  return (
    typeof e === "object" &&
    e !== null &&
    typeof e.sessionId === "string" &&
    typeof e.repo === "string" &&
    typeof e.number === "number" &&
    typeof e.at === "number" &&
    (e.before === undefined || typeof e.before === "string")
  );
};

export class SessionRemovals {
  private file: string;
  private log: (...args: unknown[]) => void;
  private now: () => number;
  private entries = new Map<string, SessionRemoval>();
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
        let v: { sessions?: unknown } | null;
        try {
          v = JSON.parse(raw) as { sessions?: unknown } | null;
        } catch (e) {
          // Starts with none: the next one sent a review writes the file anew.
          this.log("github-review: the file of the sessions to remove is broken; starting with none", e);
          return;
        }
        for (const e of Array.isArray(v?.sessions) ? v.sessions : []) if (isEntry(e)) this.entries.set(e.sessionId, e);
      },
      (e: unknown) => {
        if ((e as { code?: unknown }).code !== "ENOENT") this.log("github-review: could not read the sessions to remove", e);
      },
    );
    return this.loaded;
  }

  private save(): Promise<void> {
    const body = `${JSON.stringify({ sessions: [...this.entries.values()] }, null, 2)}\n`;
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, body);
      await fs.rename(tmp, this.file);
    });
    return this.writing;
  }

  /** Those still waited for, the oldest first; the ones too old are forgotten. */
  async all(): Promise<SessionRemoval[]> {
    await this.load();
    const old = [...this.entries.values()].filter((e) => this.now() - e.at > REMOVAL_MAX_AGE_MS);
    for (const e of old) {
      this.entries.delete(e.sessionId);
      this.claims.delete(e.sessionId);
    }
    if (old.length > 0) await this.save();
    return [...this.entries.values()];
  }

  /** `sessionId` is sent the review of `repo`#`number` now; `before`: the comment of the latest verdict until now. */
  async track(sessionId: string, repo: string, number: number, before: string | undefined): Promise<void> {
    await this.load();
    this.entries.delete(sessionId);
    this.claims.delete(sessionId);
    this.entries.set(sessionId, { sessionId, repo, number, at: this.now(), ...(before ? { before } : {}) });
    while (this.entries.size > MAX_REMOVALS) this.entries.delete(this.entries.keys().next().value as string);
    await this.save();
  }

  /** Not to be removed: it was, it is gone, or it was given other work. */
  async forget(sessionId: string): Promise<void> {
    await this.load();
    this.claims.delete(sessionId);
    if (this.entries.delete(sessionId)) await this.save();
  }

  /** A page is about to remove it: true for the first to ask, until the claim runs out. */
  async claim(sessionId: string): Promise<boolean> {
    await this.load();
    if (!this.entries.has(sessionId)) return false;
    const at = this.claims.get(sessionId);
    if (at !== undefined && this.now() - at < REMOVAL_CLAIM_MS) return false;
    this.claims.set(sessionId, this.now());
    return true;
  }
}
