// What the usage plugin's ring and popover show, worked out apart from React so that it can be tested: the ring's
// tone, which usage limits to show (get_usage's, the status line's, or both), and how numbers and times are written.
import type { MachineInfo, PlanLimits } from "@gasho/plugin-sdk";
import type { LimitWindow, UsageLimits } from "../types.ts";

/** How the ring looks at a share of the context window: as the text around it, then amber from 70%, then red from 90%. */
export type Tone = "normal" | "warn" | "danger";

export function toneOf(percent: number): Tone {
  return percent >= 90 ? "danger" : percent >= 70 ? "warn" : "normal";
}

/** A share as a whole number from 0 to 100, cut as /usage cuts it (99.7% is 99%), so that 100% means used up. */
export function clampPercent(p: number): number {
  return Math.min(100, Math.max(0, Math.floor(p)));
}

/** "45,615" */
export function tokens(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/**
 * The freshest usage limits that a session of the working server reported through its status line. They are the
 * account's, and the sessions of one working server use the same login; each knows them as of its latest reply.
 */
export function latestStatusLineLimits(machine: Pick<MachineInfo, "sessions">): PlanLimits | undefined {
  let best: PlanLimits | undefined;
  for (const s of machine.sessions) if (s.limits && (!best || s.limits.at > best.at)) best = s.limits;
  return best;
}

/** One limit in the popover. */
export interface LimitRow {
  key: string;
  label: string;
  window: LimitWindow;
  /** When get_usage read it, for a row older than the rest of the popover (`LimitsView.at`). */
  at?: number;
}

/**
 * The limits the popover shows, as of `at`: read with get_usage (`usage`), or reported through the status line
 * (`statusline`), whichever is newer. The status line has no limits of single models: those get_usage read before stay,
 * with the time they were read. "none": no Claude.ai plan, so no limits.
 */
export type LimitsView = { source: "usage" | "statusline"; at: number; rows: LimitRow[] } | { source: "none" };

export function limitsView(read: UsageLimits | undefined, reported: PlanLimits | undefined): LimitsView | undefined {
  // Not available to get_usage: no plan, or a login whose token may not read the usage (setup-token), whose replies
  // still bring the limits to the status line.
  const usage = read?.available ? read : undefined;
  if (!usage && !reported) return read ? { source: "none" } : undefined;
  const line = usage && (!reported || usage.at >= reported.at) ? undefined : reported;
  // get_usage's rows are older than the rest while the status line is newer.
  const older = line ? usage?.at : undefined;
  const rows: LimitRow[] = [];
  const add = (key: string, label: string, w: LimitWindow | undefined, fromUsage: boolean) => {
    if (w) rows.push({ key, label, window: w, ...(fromUsage && older !== undefined ? { at: older } : {}) });
  };
  add("five-hour", "5時間の上限", line?.fiveHour ?? usage?.fiveHour, !line?.fiveHour);
  add("seven-day", "週の上限（すべてのモデル）", line?.sevenDay ?? usage?.sevenDay, !line?.sevenDay);
  add("seven-day-sonnet", "週の上限（Sonnet）", usage?.sevenDaySonnet, true);
  for (const m of usage?.models ?? []) add(`model:${m.name}`, `週の上限（${m.name}）`, m, true);
  return line ? { source: "statusline", at: line.at, rows } : { source: "usage", at: (usage as UsageLimits).at, rows };
}

/** The share of a limit the popover shows: none once it has been reset, when the share read before no longer holds. */
export function shownPercent(w: LimitWindow, now: number): number | undefined {
  return w.resetsAt !== undefined && w.resetsAt <= now ? undefined : clampPercent(w.percent);
}

const WEEKDAYS = "日月火水木金土";

/**
 * When a limit starts again, in the browser's time zone: "17:00 にリセット" today, "11月18日（水）17:00 にリセット" after.
 * To the nearest minute: Claude.ai gives one limit 13:59:59.7 and the next 14:00:00, which are the same time.
 */
export function resetLabel(resetsAt: number, now: number): string {
  if (resetsAt <= now) return "リセット済み";
  const d = new Date(Math.round(resetsAt / 60_000) * 60_000);
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === new Date(now).toDateString()) return `${time} にリセット`;
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）${time} にリセット`;
}
