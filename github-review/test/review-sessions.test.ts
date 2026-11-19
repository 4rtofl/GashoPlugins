import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { finishedNotification, MAX_REVIEW_SESSIONS, REVIEW_SESSION_MS, ReviewSessions } from "../src/daemon/review-sessions.ts";
import type { ReviewMark } from "../src/verdict.ts";

const SHA = "a".repeat(40);
const ASKED = Date.parse("2026-11-18T10:00:00Z");
const mark = (o: Partial<ReviewMark> = {}): ReviewMark => ({ verdict: "mergeable", sha: SHA, url: "https://github.com/o/r/pull/5#c", at: "2026-11-18T10:30:00Z", ...o });
const pr = (m?: ReviewMark, head = SHA) => ({ repo: "o/r", number: 5, title: "直す", head, ...(m ? { mark: m } : {}) });
const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "github-review-sessions-")), "review-sessions.json");

test("a review posted on the head now is notified with its verdict", () => {
  assert.deepEqual(finishedNotification(pr(mark()), { at: ASKED }), { title: "#5 のレビューが終わりました（マージできます）", body: "o/r「直す」" });
  assert.equal(finishedNotification(pr(mark({ verdict: "changes" })), { at: ASKED })?.title, "#5 のレビューが終わりました（直すところがあります）");
});

test("no notification while the review is not posted: no mark, another head, or an earlier review's mark", () => {
  assert.equal(finishedNotification(pr(), { at: ASKED }), undefined);
  assert.equal(finishedNotification(pr(mark(), "b".repeat(40)), { at: ASKED }), undefined);
  assert.equal(finishedNotification(pr(mark({ at: "2026-11-18T09:00:00Z" })), { at: ASKED }), undefined);
  const { at: _, ...undated } = mark();
  assert.equal(finishedNotification(pr(undated), { at: ASKED }), undefined);
});

test("a mark a little before the request counts, as the clocks may differ", () => {
  assert.ok(finishedNotification(pr(mark({ at: "2026-11-18T09:59:30Z" })), { at: ASKED }));
});

test("the sessions under review outlast a restart, until forgotten", async () => {
  const f = file();
  const a = new ReviewSessions({ file: f, log: () => undefined, now: () => ASKED });
  await a.track("s1", "o/r", 5);
  const b = new ReviewSessions({ file: f, log: () => undefined, now: () => ASKED });
  assert.deepEqual(await b.get("s1"), { sessionId: "s1", repo: "o/r", number: 5, at: ASKED });
  await b.forget("s1");
  assert.equal(await new ReviewSessions({ file: f, log: () => undefined }).get("s1"), undefined);
  // A broken file starts from none, and the next one tracked writes it anew.
  fs.writeFileSync(f, "{ broken");
  const c = new ReviewSessions({ file: f, log: () => undefined, now: () => ASKED });
  assert.equal(await c.get("s1"), undefined);
  await c.track("s2", "o/r", 6);
  assert.deepEqual(await new ReviewSessions({ file: f, log: () => undefined, now: () => ASKED }).get("s2"), { sessionId: "s2", repo: "o/r", number: 6, at: ASKED });
});

test("a review too old is not waited for, and only the latest sessions are kept", async () => {
  let now = ASKED;
  const s = new ReviewSessions({ file: file(), log: () => undefined, now: () => now });
  await s.track("old", "o/r", 1);
  now += REVIEW_SESSION_MS + 1;
  assert.equal(await s.get("old"), undefined);
  for (let i = 0; i <= MAX_REVIEW_SESSIONS; i++) await s.track(`s${i}`, "o/r", i + 1);
  assert.equal(await s.get("s0"), undefined);
  assert.equal((await s.get(`s${MAX_REVIEW_SESSIONS}`))?.number, MAX_REVIEW_SESSIONS + 1);
});
