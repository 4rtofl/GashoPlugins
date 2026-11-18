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

/** I requested changes after the review's comment (both by GitHub's clock): what "差し戻す" asks is done. */
export function sentBack(pr: { changesRequestedAt?: string; mark?: { at?: string } }): boolean {
  const requested = pr.changesRequestedAt ? Date.parse(pr.changesRequestedAt) : Number.NaN;
  const reviewed = pr.mark?.at ? Date.parse(pr.mark.at) : Number.NaN;
  return !Number.isNaN(requested) && !Number.isNaN(reviewed) && requested >= reviewed;
}

/** The button a pull request's row shows for where its review is; undefined for none. */
export function askOf(
  pr: { own?: boolean; fork?: boolean; canModify?: boolean; conflict?: boolean; changesRequestedAt?: string; mark?: { at?: string } },
  progress: ReviewProgress | undefined,
): Ask | undefined {
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
    if (pr.own) return { kind: "fix", label: "修正してもらう" };
    return sentBack(pr) ? undefined : { kind: "sendBack", label: "差し戻す" };
  }
  return undefined;
}

/** What a pull request's buttons ask an Agent for: what its verdict calls for, or a review ("レビューする"). */
export type WorkKind = AskKind | "review";

/** What a row's button asked the Agent, on the page: of the verdict on `sha` (a review: the head without one), at `at` (ms since the epoch). */
export interface Asked {
  kind: WorkKind;
  sha: string;
  at: number;
}

/** A session's state may come this long after it was sent something. */
export const ASK_SETTLE_MS = 20_000;

/**
 * Whether what the row's button asks is being done, so that the row shows that in place of the button: it was asked
 * of the verdict there is now (on the page, `asked`, or kept to remove the worktree after, `followed`; each names the
 * head of its verdict), and a session in the worktree works, or it was asked a moment ago. A session at work on the
 * review itself is not it, nor one at work after an ask of an earlier verdict.
 */
export function askRunning(
  ask: Ask | undefined,
  mark: { sha: string } | undefined,
  { working, asked, followed, now }: { working: boolean; asked?: Asked | undefined; followed?: { kind: AskKind; sha?: string } | undefined; now: number },
): boolean {
  if (!ask || !mark) return false;
  const mine = asked && asked.kind === ask.kind && asked.sha === mark.sha ? asked : undefined;
  if (mine && now - mine.at < ASK_SETTLE_MS) return true;
  const kept = followed?.kind === ask.kind && followed.sha === mark.sha;
  return working && (mine !== undefined || kept);
}

/** Once what was asked is no longer being done, the row waits this long at most for its list to be read again. */
export const ASK_RECHECK_MS = 30_000;

/**
 * What was asked of the verdict on `sha` was seen to end at `ended`, and GitHub had been read again by `refreshed`
 * (ms since the epoch, by the page's clock).
 */
export interface Recheck {
  kind: Underway;
  sha: string;
  ended: number;
  refreshed?: number;
}

/**
 * Once what was asked is no longer being done, the row's list is still from before the end of it (a pull request just
 * merged is open there, with the button that asks for the merge): the row goes on saying it is being done until the
 * list read from GitHub after that comes (`listedAt`: when the oldest of its lists came), or ASK_RECHECK_MS have passed.
 */
export function askRechecking(
  ask: Ask | undefined,
  mark: { sha: string } | undefined,
  { recheck, listedAt, now }: { recheck?: Recheck | undefined; listedAt?: number | undefined; now: number },
): boolean {
  if (!ask || !mark || !recheck || recheck.kind !== ask.kind || recheck.sha !== mark.sha) return false;
  return awaitsReading(recheck, listedAt, now);
}

/** The list read from GitHub since the end of the work has not come, and it is not too late to wait for it. */
const awaitsReading = (recheck: Recheck, listedAt: number | undefined, now: number): boolean =>
  now - recheck.ended < ASK_RECHECK_MS && (recheck.refreshed === undefined || (listedAt ?? 0) <= recheck.refreshed);

/**
 * What was asked on this screen is no longer being done, and GitHub was not read for that since it was asked: its end
 * was not seen, as the page was left meanwhile. The list is from before the end of it, so the row reads GitHub again now.
 */
export function askEndUnseen(
  ask: Ask | undefined,
  mark: { sha: string } | undefined,
  { running, asked, recheck }: { running: boolean; asked?: Asked | undefined; recheck?: Recheck | undefined },
): boolean {
  if (running || !ask || !mark || !asked || asked.kind !== ask.kind || asked.sha !== mark.sha) return false;
  return recheck === undefined || recheck.ended < asked.at;
}

/**
 * What goes on in a pull request's worktree, for which its row shows no button that asks an Agent for something:
 * - a kind of AskKind: that was asked, and is being done (askRunning);
 * - review: a review was asked on this screen, or a session sent one is at work;
 * - session: some other session is at work there. What it does cannot be told (what was asked before the page was opened
 *   is not kept), and whatever was sent now would wait for it.
 */
export type Underway = WorkKind | "session";

/**
 * What is under way in the worktree of an open pull request; undefined when nothing is. What was asked last on this
 * screen goes first, then a session sent a review, then what the daemon part kept of an ask.
 */
export function underway(
  ask: Ask | undefined,
  mark: { sha: string } | undefined,
  {
    working,
    reviewing,
    asked,
    followed,
    now,
  }: { working: boolean; reviewing: boolean; asked?: Asked | undefined; followed?: { kind: AskKind; sha?: string } | undefined; now: number },
): Underway | undefined {
  if (asked?.kind === "review" && (working || now - asked.at < ASK_SETTLE_MS)) return "review";
  if (ask && askRunning(ask, mark, { working, asked, now })) return ask.kind;
  if (reviewing) return "review";
  if (ask && askRunning(ask, mark, { working, followed, now })) return ask.kind;
  return working ? "session" : undefined;
}

/**
 * Once the work is over, its row goes on showing it until the list read from GitHub after that comes: until then, the list
 * is from before the end of it. What was asked of a verdict is waited for while that verdict stands (askRechecking).
 */
export function workRechecking(
  ask: Ask | undefined,
  mark: { sha: string } | undefined,
  { recheck, listedAt, now }: { recheck?: Recheck | undefined; listedAt?: number | undefined; now: number },
): Underway | undefined {
  if (!recheck) return undefined;
  const waits = recheck.kind === "review" || recheck.kind === "session" ? awaitsReading(recheck, listedAt, now) : askRechecking(ask, mark, { recheck, listedAt, now });
  return waits ? recheck.kind : undefined;
}

/** What was asked on this screen is over and its end was not seen, as the page was left meanwhile (askEndUnseen). */
export function workEndUnseen(
  ask: Ask | undefined,
  mark: { sha: string } | undefined,
  { going, asked, recheck }: { going: boolean; asked?: Asked | undefined; recheck?: Recheck | undefined },
): boolean {
  if (asked?.kind === "review") return !going && (recheck === undefined || recheck.ended < asked.at);
  return askEndUnseen(ask, mark, { running: going, asked, recheck });
}
