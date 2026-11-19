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
  /** When this view took it (the browser's clock); absent in those of Pondering 1.0.1 and before. */
  seen?: number;
  /**
   * The start Gasho still told when this work was first seen: the last work's. Gasho learns the new start a moment
   * after the session is seen working (the hook of the message comes after), so a start this close is not this work's.
   */
  before?: number;
}

const near = (a: number | undefined, b: number): boolean => a !== undefined && Math.abs(a - b) <= SAME_WORK_MS;

/**
 * Whether the work Gasho says started at `turn` is the one `base` was taken for. Once Gasho no longer knows the start
 * (undefined), it is that work only while this view has watched it go on since the start was known (`watched`): a
 * baseline kept from before a reload may be of an earlier work.
 */
export function sameWork(base: Baseline, turn: number | undefined, watched: boolean): boolean {
  if (turn === undefined) return base.turn === undefined || watched;
  return near(base.turn ?? base.before, turn);
}

/**
 * Whether `turn`, told as this view first sees the session working again, is still the last work's start: that of the
 * last baseline, or one from before this view saw the session out of work (`idleSince`). Without the Stop hook of the
 * last work among the hooks Gasho keeps, Gasho tells the last message in the conversation, however old. A start from
 * less than LATE_MS ago may be this work's, sent before this view learned that the last one had ended.
 */
function lastStart(base: Baseline | null, turn: number, now: number, idleSince: number): boolean {
  return (base !== null && near(base.turn ?? base.before, turn)) || (now - turn >= LATE_MS && turn < idleSince);
}

/**
 * The baseline once the session is seen working on the work at `turn` with `output` tokens written: `base` for the same
 * work, a new one from now for another. `idleSince`: when this view first saw the session out of work since `base` was
 * taken (the browser's clock), if it did; it then sees this work from its start. A start Gasho no longer knows keeps
 * the baseline, so that the count goes on once the start is known again.
 */
export function nextBaseline(base: Baseline | null, turn: number | undefined, output: number, now: number, idleSince: number | undefined): Baseline {
  const fresh = idleSince !== undefined;
  if (base && !fresh) {
    if (turn === undefined || sameWork(base, turn, false)) return base;
    // The start of a work seen from its start, told later: the count goes on from where it began.
    if (base.turn === undefined && base.early && base.seen !== undefined && Math.abs(turn - base.seen) <= LATE_MS) {
      return { turn, output: base.output, early: true, seen: base.seen };
    }
  }
  if (fresh && turn !== undefined && lastStart(base, turn, now, idleSince)) return { output, early: true, seen: now, before: turn };
  return { ...(turn !== undefined ? { turn } : {}), output, early: fresh || (turn !== undefined && now - turn < LATE_MS), seen: now };
}

/** What Pondering shows of the work going on. */
export interface Shown {
  /** When it started, as first seen; undefined when not known. */
  start: number | undefined;
  /** The tokens written since; undefined when they are not counted from its start. */
  tokens: number | undefined;
  /**
   * What its phrase is picked from: the baseline's count of tokens, which stays through the work while Gasho's start
   * comes late or moves, so that the phrase does not change in the middle of it.
   */
  seed: number | undefined;
}

export function shown(base: Baseline | null, turn: number | undefined, output: number | undefined, watched: boolean): Shown {
  if (!base || !sameWork(base, turn, watched)) return { start: turn, tokens: undefined, seed: turn ?? base?.output };
  return { start: base.turn, tokens: base.early && output !== undefined ? output - base.output : undefined, seed: base.output };
}

/** Baselines kept in this browser: those of the sessions whose work was seen last. */
export const KEPT = 50;

/** The keys of the baselines to remove, past the KEPT seen last (those without a time count as the oldest). */
export function dropped(stored: [key: string, base: Baseline | null][]): string[] {
  if (stored.length <= KEPT) return [];
  const at = (b: Baseline | null) => b?.seen ?? b?.turn ?? 0;
  return [...stored]
    .sort((a, b) => at(b[1]) - at(a[1]))
    .slice(KEPT)
    .map(([key]) => key);
}
