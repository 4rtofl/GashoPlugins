// Removing the session a review was sent to, once it has posted the result. The page says which session it sent the
// review to; the daemon part keeps that (session-removals.ts) and tells, with each list, the sessions whose review is
// posted. Once such a session is at rest, the page removes it (useRemoveSession). Its worktree stays, and so does its
// conversation on the working server. Only the session the review was sent to goes: on my own pull request, the session
// that made the changes shares the worktree.
import { CLOCK_SLACK_MS } from "./cleanup.ts";
import type { ReviewMark } from "./verdict.ts";

/** A review sent to a session. */
export interface TrackedReview {
  /** When it was sent (ms since the epoch, the working server's clock). */
  at: number;
  /** The comment of the latest verdict when it was sent: an earlier review's, which does not count. */
  before?: string;
}

/** Whether the latest verdict is the result of the review sent: a new comment, posted after it was sent. */
export function reviewPosted(mark: Pick<ReviewMark, "url" | "at"> | undefined, review: TrackedReview): boolean {
  if (!mark?.at || mark.url === review.before) return false;
  const posted = Date.parse(mark.at);
  return Number.isFinite(posted) && posted >= review.at - CLOCK_SLACK_MS;
}

/** A session that has ended its turn, with nothing waiting to be typed into it. */
export const atRest = (s: { status: string; pendingInputs?: number }): boolean => s.status === "idle" && (s.pendingInputs ?? 0) === 0;
