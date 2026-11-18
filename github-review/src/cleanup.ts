// Removing a review worktree once what "マージしてもらう" or "差し戻す" asked is done. The page asks with
// "終わったら片付ける" (on by default); the daemon part keeps that it was asked (cleanups.ts) and tells, with each list,
// whether it is done: the pull request was merged, or I requested changes on it after it was asked. A merge that did
// not happen (a conflict whose resolution changed the content, failing checks…) is never done, and its worktree stays.
// Once it is done and no session in the worktree is at work (the Agent has told how it went), the page removes the
// worktree with the sessions in it, as Gasho's sidebar does (useRemoveWorktree): never with uncommitted changes or
// commits that were not pushed, which it names on the row instead.

export type CleanupKind = "merge" | "sendBack";

export const CLEANUP_KINDS: readonly CleanupKind[] = ["merge", "sendBack"];

/**
 * Whether a pull request's worktree may be removed once `kind` is done. After a merge, any worktree of the pull request
 * may, whatever its name; after a send-back the work goes on, so only one made for the review. Never the primary checkout.
 */
export function cleanable(kind: CleanupKind, worktree: { path: string; review: boolean }, primary: string): boolean {
  return worktree.path !== primary && (kind === "merge" || worktree.review);
}

/** The clocks of the working server and of GitHub may differ by this much. */
export const CLOCK_SLACK_MS = 60_000;

/** Whether what was asked at `askedAt` (ms since the epoch, the working server's clock) is done. */
export function cleanupDone(kind: CleanupKind, pr: { state: string; changesRequestedAt?: string }, askedAt: number): boolean {
  if (kind === "merge") return pr.state === "merged";
  const at = pr.changesRequestedAt ? Date.parse(pr.changesRequestedAt) : Number.NaN;
  return !Number.isNaN(at) && at >= askedAt - CLOCK_SLACK_MS;
}

/** Why a worktree was not removed, from what kept it (useRemoveWorktree's `changes`). */
export function changesProblem(c: { uncommitted: number; unpushed: number }): string {
  const parts = [c.uncommitted > 0 ? `未コミットの変更（${c.uncommitted} 件）` : undefined, c.unpushed > 0 ? `push していない commit（${c.unpushed} 個）` : undefined].filter(Boolean);
  return `${parts.join("と ") || "消すと失われるもの"}があるので、自動では片付けませんでした。`;
}
