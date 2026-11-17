// The verdict of a review, as the Agent writes it in the comment it posts on the pull request: a mark the page of
// GitHub does not show, `<!-- gasho-review verdict=mergeable sha=<the head reviewed> -->` (`verdict` is "mergeable" or
// "changes"). The daemon part reads the marks of the comments I wrote (the latest few of each pull request); the row
// shows where the review is from the latest mark, the head now, and the sessions working in its worktrees.
import { canPush } from "./types.ts";

export type Verdict = "mergeable" | "changes";

/** The latest mark I wrote on a pull request. */
export interface ReviewMark {
  verdict: Verdict;
  /** The head that was reviewed (lower case). */
  sha: string;
  /** The comment that holds it. */
  url: string;
  /** ISO 8601 */
  at?: string;
}

const MARK = /<!--\s*gasho-review\s+verdict=(mergeable|changes)\s+sha=([0-9a-f]{7,40})\s*-->/gi;

/** The mark of a comment's body (the last, when it holds several); undefined when it holds none. */
export function readMark(body: string): { verdict: Verdict; sha: string } | undefined {
  let found: { verdict: Verdict; sha: string } | undefined;
  for (const m of body.matchAll(MARK)) found = { verdict: (m[1] ?? "").toLowerCase() as Verdict, sha: (m[2] ?? "").toLowerCase() };
  return found;
}

/** A comment's body without its marks, to show. */
export const withoutMark = (body: string): string => body.replace(MARK, "").trimEnd();

/** A comment as GitHub gives it, oldest first. */
export interface MarkComment {
  mine: boolean;
  body: string;
  url: string;
  at?: string;
}

/** The latest mark of the comments I wrote; the others' never count, whatever they hold. */
export function latestMark(comments: readonly MarkComment[]): ReviewMark | undefined {
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i];
    if (!c?.mine) continue;
    const m = readMark(c.body);
    if (m) return { ...m, url: c.url, ...(c.at ? { at: c.at } : {}) };
  }
  return undefined;
}

/** A mark's sha names the head: the whole of it, or (a hand-written one) its start. */
export function sameHead(sha: string, head: string | undefined): boolean {
  if (!head) return false;
  const h = head.toLowerCase();
  return sha.length === h.length ? sha === h : h.startsWith(sha);
}

/**
 * Where the review of a pull request is, on its row:
 * - reviewing: a session in its worktree works (or waits for an answer) and no mark names the head now;
 * - mergeable / changes: the latest mark names the head now;
 * - stale: the latest mark names another head (a push came after the review).
 * Undefined for one that is no longer open, or that no mark nor session speaks of.
 */
export type ReviewProgress = "reviewing" | "mergeable" | "changes" | "stale";

export function reviewProgress(pr: { state: string; head?: string; mark?: ReviewMark }, working: boolean): ReviewProgress | undefined {
  if (pr.state !== "open") return undefined;
  const { mark } = pr;
  if (mark && sameHead(mark.sha, pr.head)) return mark.verdict;
  if (working) return "reviewing";
  return mark ? "stale" : undefined;
}

/** A session works on something: busy, waiting for an answer, or with inputs waiting until it is idle. */
export function working(sessions: readonly { cwd: string; status: string; pendingInputs?: number }[], dir: string): boolean {
  return sessions.some((s) => (s.cwd === dir || s.cwd.startsWith(`${dir}/`)) && (s.status === "busy" || s.status === "waiting" || (s.pendingInputs ?? 0) > 0));
}

/** What the row's button asks the Agent: merge it, send it back (request changes), or mend my own. */
export type AskKind = "merge" | "sendBack" | "fix";

export interface Ask {
  kind: AskKind;
  label: string;
  /** Why the button cannot be pressed. */
  blocked?: string;
}

/** The button a pull request's row shows for where its review is; undefined for none. */
export function askOf(pr: { own?: boolean; fork?: boolean; canModify?: boolean; conflict?: boolean }, progress: ReviewProgress | undefined): Ask | undefined {
  if (progress === "mergeable") {
    return {
      kind: "merge",
      label: "マージしてもらう",
      ...(pr.conflict && !canPush(pr)
        ? { blocked: "base とのコンフリクトがありますが、fork の head に push できない（maintainer の変更を許していない）ので、ここでは解決できません。" }
        : {}),
    };
  }
  if (progress === "changes") {
    // GitHub lets no one request changes on their own pull request: the Agent mends it instead.
    return pr.own ? { kind: "fix", label: "修正してもらう" } : { kind: "sendBack", label: "差し戻す" };
  }
  return undefined;
}
