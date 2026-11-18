import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlanLimits, SessionInfo } from "@gasho/plugin-sdk";
import { clampPercent, latestStatusLineLimits, limitsView, resetLabel, tokens, toneOf } from "../src/web/limits.ts";
import type { UsageLimits } from "../src/types.ts";

// The reset times are written in the browser's time zone; these tests read them in Japan's.
process.env.TZ = "Asia/Tokyo";

const WEEK = { percent: 36, resetsAt: Date.parse("2026-11-18T08:00:00Z") };

test("the ring is as the text around it below 70%, amber from 70%, and red from 90%", () => {
  assert.equal(toneOf(0), "normal");
  assert.equal(toneOf(69), "normal");
  assert.equal(toneOf(70), "warn");
  assert.equal(toneOf(89), "warn");
  assert.equal(toneOf(90), "danger");
  assert.equal(toneOf(100), "danger");
  assert.equal(clampPercent(-3), 0);
  assert.equal(clampPercent(36.4), 36);
  // Cut as /usage cuts it: a limit is not shown used up before it is.
  assert.equal(clampPercent(99.7), 99);
  assert.equal(clampPercent(140), 100);
});

test("tokens are written with commas", () => {
  assert.equal(tokens(45615), "45,615");
  assert.equal(tokens(1_000_000), "1,000,000");
  assert.equal(tokens(0), "0");
});

test("the status line's limits come from the session that replied last on the working server", () => {
  const session = (sessionId: string, limits?: PlanLimits) => ({ sessionId, cwd: "/r", status: "idle", rcMode: "interactive", prLinks: [], limits }) as SessionInfo;
  assert.equal(latestStatusLineLimits({ sessions: [] }), undefined);
  const older = { sevenDay: { ...WEEK, percent: 35 }, at: 100 };
  const newer = { sevenDay: WEEK, at: 200 };
  assert.equal(latestStatusLineLimits({ sessions: [session("a", older), session("b"), session("c", newer)] }), newer);
});

const READ: UsageLimits = {
  at: 500,
  available: true,
  fiveHour: { percent: 0 },
  sevenDay: WEEK,
  sevenDaySonnet: { percent: 4, resetsAt: WEEK.resetsAt },
  models: [{ name: "Fable", percent: 0, resetsAt: WEEK.resetsAt }],
};

test("the popover shows get_usage's limits, with the 5-hour one first and the models' last", () => {
  assert.deepEqual(limitsView(READ, { sevenDay: { ...WEEK, percent: 35 }, at: 400 }), {
    source: "usage",
    at: 500,
    rows: [
      { key: "five-hour", label: "5時間の上限", window: { percent: 0 } },
      { key: "seven-day", label: "週の上限（すべてのモデル）", window: WEEK },
      { key: "seven-day-sonnet", label: "週の上限（Sonnet）", window: { percent: 4, resetsAt: WEEK.resetsAt } },
      { key: "model:Fable", label: "週の上限（Fable）", window: { name: "Fable", percent: 0, resetsAt: WEEK.resetsAt } },
    ],
  });
});

test("a reply after get_usage's read brings the status line's limits; get_usage's stay where it has none, as of their read", () => {
  const newer = { sevenDay: { ...WEEK, percent: 40 }, at: 9_000_000 };
  assert.deepEqual(limitsView(READ, newer), {
    source: "statusline",
    at: 9_000_000,
    rows: [
      { key: "five-hour", label: "5時間の上限", window: { percent: 0 }, at: 500 },
      { key: "seven-day", label: "週の上限（すべてのモデル）", window: { ...WEEK, percent: 40 } },
      { key: "seven-day-sonnet", label: "週の上限（Sonnet）", window: { percent: 4, resetsAt: WEEK.resetsAt }, at: 500 },
      { key: "model:Fable", label: "週の上限（Fable）", window: { name: "Fable", percent: 0, resetsAt: WEEK.resetsAt }, at: 500 },
    ],
  });
});

test("without get_usage's limits, the popover shows the status line's; without either, nothing; without a plan, none", () => {
  assert.deepEqual(limitsView(undefined, { sevenDay: WEEK, at: 600 }), {
    source: "statusline",
    at: 600,
    rows: [{ key: "seven-day", label: "週の上限（すべてのモデル）", window: WEEK }],
  });
  assert.equal(limitsView(undefined, undefined), undefined);
  assert.deepEqual(limitsView({ at: 1, available: false, models: [] }, undefined), { source: "none" });
  // A login get_usage cannot read with (claude setup-token) still gets the limits through the status line.
  assert.deepEqual(limitsView({ at: 700, available: false, models: [] }, { sevenDay: WEEK, at: 600 }), {
    source: "statusline",
    at: 600,
    rows: [{ key: "seven-day", label: "週の上限（すべてのモデル）", window: WEEK }],
  });
});

test("a reset is written as a time today, with the date and the day of the week after, and as done once it has passed", () => {
  // 0:00 on Sunday, 15 November, in Tokyo.
  const now = Date.parse("2026-11-14T15:00:00Z");
  assert.equal(resetLabel(Date.parse("2026-11-15T08:00:00Z"), now), "17:00 にリセット");
  assert.equal(resetLabel(WEEK.resetsAt, now), "11月18日（水）17:00 にリセット");
  assert.equal(resetLabel(Date.parse("2026-11-15T00:05:00Z"), now), "9:05 にリセット");
  // Claude.ai gives the weekly limit 13:59:59.7 and the model's 14:00:00: both are 23:00.
  assert.equal(resetLabel(Date.parse("2026-11-21T13:59:59.707Z"), now), "11月21日（土）23:00 にリセット");
  assert.equal(resetLabel(Date.parse("2026-11-21T14:00:00Z"), now), "11月21日（土）23:00 にリセット");
  assert.equal(resetLabel(now - 1, now), "リセット済み");
  assert.equal(resetLabel(now, now), "リセット済み");
});
