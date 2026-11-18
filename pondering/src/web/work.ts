// Which piece of work a session is on, told from Gasho's start of it (turnStartedAt), and the tokens written since:
// Pondering counts them from the session's count as first seen in the work, and keeps the start as first seen.

/** The tokens of the work are counted from the session's count as first seen. Seen later than this, some are missed. */
export const LATE_MS = 20_000;

/**
 * Starts this close are of the same work. Gasho gives the start from the hook of the person's message and, once that
 * hook is no longer among the latest it keeps (a reloaded page gets fewer of them), from the message in the
 * conversation: the two differ by milliseconds. Gasho matches the two by the same 10 seconds.
 */
export const SAME_WORK_MS = 10_000;

/** The session's count of written tokens when its work started (`turn`), and whether that was seen near the start. */
export interface Baseline {
  turn?: number;
  output: number;
  early: boolean;
}

/**
 * Whether the work Gasho says started at `turn` is the one `base` was taken for. Once Gasho no longer knows the start
 * (undefined), it is that work only while this view has watched it go on since the start was known (`watched`): a
 * baseline kept from before a reload may be of an earlier work.
 */
export function sameWork(base: Baseline, turn: number | undefined, watched: boolean): boolean {
  if (turn === undefined) return base.turn === undefined || watched;
  return base.turn !== undefined && Math.abs(turn - base.turn) <= SAME_WORK_MS;
}

/**
 * The baseline once the session is seen working on the work at `turn` with `output` tokens written: `base` for the same
 * work, a new one from now for another. `fresh`: this view saw the session out of work since, so it sees this work from
 * its start. A start Gasho no longer knows keeps the baseline, so that the count goes on once the start is known again.
 */
export function nextBaseline(base: Baseline | null, turn: number | undefined, output: number, now: number, fresh: boolean): Baseline {
  if (base && (turn === undefined ? !fresh : sameWork(base, turn, false))) return base;
  return { ...(turn !== undefined ? { turn } : {}), output, early: fresh || (turn !== undefined && now - turn < LATE_MS) };
}

/** What Pondering shows of the work going on. */
export interface Shown {
  /** When it started, as first seen; undefined when not known. */
  start: number | undefined;
  /** The tokens written since; undefined when they are not counted from its start. */
  tokens: number | undefined;
  /** The start its phrase is picked from: the baseline's while Gasho no longer knows the start, so that it stays. */
  phraseAt: number | undefined;
}

export function shown(base: Baseline | null, turn: number | undefined, output: number | undefined, watched: boolean): Shown {
  if (!base || !sameWork(base, turn, watched)) return { start: turn, tokens: undefined, phraseAt: turn ?? base?.turn };
  return { start: base.turn, tokens: base.early && output !== undefined ? output - base.output : undefined, phraseAt: base.turn };
}
