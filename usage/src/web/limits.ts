// What the usage plugin's ring and popover show, worked out apart from React so that it can be tested: the ring's
// tone, which usage limits to show (get_usage's, else the status line's), and how numbers and times are written.
import type { MachineInfo, PlanLimits, UsageWindow } from "@gasho/plugin-sdk";
import type { UsageLimits } from "../types.ts";

/** How the ring looks at a share of the context window: as the text around it, then amber from 70%, then red from 90%. */
export type Tone = "normal" | "warn" | "danger";

export function toneOf(percent: number): Tone {
  return percent >= 90 ? "danger" : percent >= 70 ? "warn" : "normal";
}

/** A share as a whole number from 0 to 100 (Claude Code sends whole numbers; this keeps the ring and the bars in range). */
export function clampPercent(p: number): number {
  return Math.min(100, Math.max(0, Math.round(p)));
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
  window: UsageWindow;
}

/**
 * The limits the popover shows: read with get_usage (`usage`, all of them, as of when they were read), else reported
 * through the status line (`statusline`, without the models', as of a reply). "none": not a Claude.ai plan.
 */
export type LimitsView = { source: "usage" | "statusline"; at: number; rows: LimitRow[] } | { source: "none" };

export function limitsView(read: UsageLimits | undefined, reported: PlanLimits | undefined): LimitsView | undefined {
  if (read && !read.available) return { source: "none" };
  const from = read ?? reported;
  if (!from) return undefined;
  const rows: LimitRow[] = [];
  if (from.fiveHour) rows.push({ key: "five-hour", label: "5時間の上限", window: from.fiveHour });
  if (from.sevenDay) rows.push({ key: "seven-day", label: "週の上限（すべてのモデル）", window: from.sevenDay });
  for (const m of read?.models ?? []) rows.push({ key: `model:${m.name}`, label: `週の上限（${m.name}）`, window: m });
  return { source: read ? "usage" : "statusline", at: from.at, rows };
}

const WEEKDAYS = "日月火水木金土";

/** When a limit starts again, in the browser's time zone: "17:00 にリセット" today, "11月18日（水）17:00 にリセット" after. */
export function resetLabel(resetsAt: number, now: number): string {
  if (resetsAt <= now) return "リセット済み";
  const d = new Date(resetsAt);
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === new Date(now).toDateString()) return `${time} にリセット`;
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）${time} にリセット`;
}
