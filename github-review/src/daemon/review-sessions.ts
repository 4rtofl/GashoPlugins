// The sessions that were sent a review, until the end of the review is notified: kept in the plugin's own folder on the
// working server (ctx.dataDir), as a review outlasts the page, and gasho-daemon may restart meanwhile.
import fs from "node:fs/promises";
import path from "node:path";
import type { ReviewMark } from "../verdict.ts";
import { sameHead } from "../verdict.ts";

export interface ReviewSession {
  sessionId: string;
  /** OWNER/REPO. */
  repo: string;
  number: number;
  /** When the review was asked for (ms since the epoch). */
  at: number;
}

/** Sessions kept, at most (the oldest go first). */
export const MAX_REVIEW_SESSIONS = 200;
/** A review not finished after this long is not waited for any more. */
export const REVIEW_SESSION_MS = 7 * 24 * 60 * 60_000;
/** GitHub's clock and this machine's may differ by this much. */
const CLOCK_MARGIN_MS = 60_000;

const isEntry = (v: unknown): v is ReviewSession => {
  const e = v as Partial<ReviewSession> | null;
  return typeof e === "object" && e !== null && typeof e.sessionId === "string" && typeof e.repo === "string" && typeof e.number === "number" && typeof e.at === "number";
};

/**
 * The notification of a finished review: when the latest mark names the head now and was posted after the review was
 * asked for (an older mark on the same head is an earlier review's). Undefined while the review is not posted.
 */
export function finishedNotification(
  pr: { repo: string; number: number; title: string; head?: string; mark?: ReviewMark },
  review: Pick<ReviewSession, "at">,
): { title: string; body: string } | undefined {
  const { mark } = pr;
  if (!mark?.at || !sameHead(mark.sha, pr.head)) return undefined;
  const posted = Date.parse(mark.at);
  if (!Number.isFinite(posted) || posted < review.at - CLOCK_MARGIN_MS) return undefined;
  const verdict = mark.verdict === "mergeable" ? "マージできます" : "直すところがあります";
  return { title: `#${pr.number} のレビューが終わりました（${verdict}）`, body: `${pr.repo}「${pr.title}」` };
}

export class ReviewSessions {
  private file: string;
  private log: (...args: unknown[]) => void;
  private now: () => number;
  private entries = new Map<string, ReviewSession>();
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
        const v = JSON.parse(raw) as { sessions?: unknown } | null;
        for (const e of Array.isArray(v?.sessions) ? v.sessions : []) if (isEntry(e)) this.entries.set(e.sessionId, e);
      },
      (e: unknown) => {
        if ((e as { code?: unknown }).code !== "ENOENT") this.log("github-review: could not read the sessions under review", e);
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

  /** The review `sessionId` was sent, unless it is too old. */
  async get(sessionId: string): Promise<ReviewSession | undefined> {
    await this.load();
    const e = this.entries.get(sessionId);
    if (!e || this.now() - e.at <= REVIEW_SESSION_MS) return e;
    await this.forget(sessionId);
    return undefined;
  }

  /** `sessionId` is sent the review of `repo`#`number` now; a review sent to it before is not waited for any more. */
  async track(sessionId: string, repo: string, number: number): Promise<void> {
    await this.load();
    this.entries.delete(sessionId);
    this.entries.set(sessionId, { sessionId, repo, number, at: this.now() });
    for (const key of [...this.entries.keys()].slice(0, Math.max(0, this.entries.size - MAX_REVIEW_SESSIONS))) this.entries.delete(key);
    await this.save();
  }

  async forget(sessionId: string): Promise<void> {
    await this.load();
    if (this.entries.delete(sessionId)) await this.save();
  }
}
