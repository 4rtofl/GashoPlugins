import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlanLimits, SessionInfo } from "@gasho/plugin-sdk";
import { clampPercent, latestStatusLineLimits, limitsView, resetLabel, shownPercent, tokens, toneOf } from "../src/web/limits.ts";
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

test("the popover shows get_usage's limits, with the 5-hour one first and the models' last", () => {
  const read: UsageLimits = {
    at: 500,
    available: true,
    fiveHour: { percent: 12, resetsAt: 1 },
    sevenDay: WEEK,
    models: [{ name: "Fable", percent: 0, resetsAt: WEEK.resetsAt }],
  };
  assert.deepEqual(limitsView(read, { sevenDay: { ...WEEK, percent: 35 }, at: 600 }), {
    source: "usage",
    at: 500,
    rows: [
      { key: "five-hour", label: "5時間の上限", window: { percent: 12, resetsAt: 1 } },
      { key: "seven-day", label: "週の上限（すべてのモデル）", window: WEEK },
      { key: "model:Fable", label: "週の上限（Fable）", window: { name: "Fable", percent: 0, resetsAt: WEEK.resetsAt } },
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
  assert.deepEqual(limitsView({ at: 1, available: false, models: [] }, { sevenDay: WEEK, at: 600 }), { source: "none" });
});

test("a reset is written as a time today, with the date and the day of the week after, and as done once it has passed", () => {
  // 0:00 on Sunday, 15 November, in Tokyo.
  const now = Date.parse("2026-11-14T15:00:00Z");
  assert.equal(resetLabel(Date.parse("2026-11-15T08:00:00Z"), now), "17:00 にリセット");
  assert.equal(resetLabel(WEEK.resetsAt, now), "11月18日（水）17:00 にリセット");
  assert.equal(resetLabel(Date.parse("2026-11-15T00:05:00Z"), now), "9:05 にリセット");
  assert.equal(resetLabel(now - 1, now), "リセット済み");
  assert.equal(resetLabel(now, now), "リセット済み");
});

test("a limit shows its share until it is reset, and none from then on, as its reset reads 「リセット済み」", () => {
  const now = Date.parse("2026-11-14T15:00:00Z");
  assert.equal(shownPercent({ percent: 36.6, resetsAt: now + 1 }, now), 37);
  assert.equal(shownPercent({ percent: 104, resetsAt: now + 1 }, now), 100);
  for (const resetsAt of [now, now - 1]) {
    assert.equal(shownPercent({ percent: 36, resetsAt }, now), undefined);
    assert.equal(resetLabel(resetsAt, now), "リセット済み");
  }
});
