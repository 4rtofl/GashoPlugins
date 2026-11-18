import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { CLOCK_SLACK_MS } from "../src/cleanup.ts";
import type { Exec } from "../src/daemon/git.ts";
import { Reviewer, type GitHubRead } from "../src/daemon/reviewer.ts";
import { MAX_REMOVALS, REMOVAL_CLAIM_MS, REMOVAL_MAX_AGE_MS, SessionRemovals } from "../src/daemon/session-removals.ts";
import { atRest, reviewPosted } from "../src/review-session.ts";

const SENT = Date.parse("2026-11-18T10:00:00Z");
const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "github-review-removals-")), "session-removals.json");

test("posted: a new comment with a verdict after the review was sent", () => {
  assert.equal(reviewPosted({ url: "u2", at: "2026-11-18T10:30:00Z" }, { at: SENT, before: "u1" }), true);
  assert.equal(reviewPosted({ url: "u2", at: "2026-11-18T10:30:00Z" }, { at: SENT }), true);
});

test("not posted: no verdict, the earlier review's comment, an older comment, or no time to go by", () => {
  assert.equal(reviewPosted(undefined, { at: SENT }), false);
  assert.equal(reviewPosted({ url: "u1", at: "2026-11-18T10:30:00Z" }, { at: SENT, before: "u1" }), false);
  assert.equal(reviewPosted({ url: "u2", at: "2026-11-18T09:00:00Z" }, { at: SENT, before: "u1" }), false);
  assert.equal(reviewPosted({ url: "u2" }, { at: SENT }), false);
  assert.equal(reviewPosted({ url: "u2", at: "not a time" }, { at: SENT }), false);
});

test("the clocks of GitHub and the working server may differ a little", () => {
  assert.equal(reviewPosted({ url: "u2", at: new Date(SENT - CLOCK_SLACK_MS).toISOString() }, { at: SENT }), true);
  assert.equal(reviewPosted({ url: "u2", at: new Date(SENT - CLOCK_SLACK_MS - 1).toISOString() }, { at: SENT }), false);
});

test("at rest: idle with nothing waiting to be typed in", () => {
  assert.equal(atRest({ status: "idle" }), true);
  assert.equal(atRest({ status: "idle", pendingInputs: 0 }), true);
  assert.equal(atRest({ status: "idle", pendingInputs: 1 }), false);
  assert.equal(atRest({ status: "idle", background: [{ id: "t" }] }), false);
  assert.equal(atRest({ status: "idle", background: [] }), true);
  assert.equal(atRest({ status: "busy" }), false);
  assert.equal(atRest({ status: "waiting" }), false);
});

test("the sessions outlast a restart, until forgotten", async () => {
  const f = file();
  const a = new SessionRemovals({ file: f, log: () => undefined, now: () => SENT });
  await a.track("s1", "o/r", 5, "u1");
  const b = new SessionRemovals({ file: f, log: () => undefined, now: () => SENT });
  assert.deepEqual(await b.all(), [{ sessionId: "s1", repo: "o/r", number: 5, at: SENT, before: "u1" }]);
  await b.forget("s1");
  assert.deepEqual(await new SessionRemovals({ file: f, log: () => undefined, now: () => SENT }).all(), []);
});

test("one page at a time claims a session, until the claim runs out; one not kept cannot be claimed", async () => {
  let now = SENT;
  const s = new SessionRemovals({ file: file(), log: () => undefined, now: () => now });
  assert.equal(await s.claim("s1"), false);
  await s.track("s1", "o/r", 5, undefined);
  assert.equal(await s.claim("s1"), true);
  assert.equal(await s.claim("s1"), false);
  now += REMOVAL_CLAIM_MS;
  assert.equal(await s.claim("s1"), true);
});

test("a review too old is not waited for, and only the latest are kept", async () => {
  let now = SENT;
  const s = new SessionRemovals({ file: file(), log: () => undefined, now: () => now });
  await s.track("old", "o/r", 1, undefined);
  now += REMOVAL_MAX_AGE_MS + 1;
  assert.deepEqual(await s.all(), []);
  for (let i = 0; i <= MAX_REMOVALS; i++) await s.track(`s${i}`, "o/r", i + 1, undefined);
  const all = await s.all();
  assert.equal(all.length, MAX_REMOVALS);
  assert.equal(all[0]?.sessionId, "s1");
});

test("list: names only the sessions whose own review is posted", async () => {
  const run = promisify(execFile);
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "github-review-removals-")));
  const primary = path.join(root, "main");
  await run("git", ["init", "-q", "-b", "main", primary]);
  await run("git", ["-C", primary, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "base"]);
  await run("git", ["-C", primary, "remote", "add", "origin", "https://github.com/o/r.git"]);
  const exec: Exec = async (command, args, o = {}) => run(command, args, { cwd: o.cwd });
  const removals = new SessionRemovals({ file: file(), log: () => undefined, now: () => SENT });
  await removals.track("posted", "O/r", 5, "old");
  await removals.track("earlier", "o/r", 6, "https://github.com/o/r/pull/6#c");
  await removals.track("other", "o/r", 7, undefined);
  const pr = (number: number, comment?: string) => ({
    number,
    title: "t",
    url: `https://github.com/o/r/pull/${number}`,
    state: "OPEN",
    headRefName: `feat/${number}`,
    repository: { nameWithOwner: "o/r" },
    recent: { nodes: comment ? [{ viewerDidAuthor: true, body: `<!-- gasho-review verdict=changes sha=${"a".repeat(40)} -->`, url: comment, createdAt: "2026-11-18T10:30:00Z" }] : [] },
  });
  const github: GitHubRead = async (args) => {
    const query = args[args.indexOf("-f") + 1] ?? "";
    if (!query.includes("search(")) return { stdout: JSON.stringify({ data: { r0: { nameWithOwner: "o/r" } } }) };
    return { stdout: JSON.stringify({ data: { req: { issueCount: 3, nodes: [pr(5, "https://github.com/o/r/pull/5#c"), pr(6, "https://github.com/o/r/pull/6#c"), pr(7)] } } }) };
  };
  const reviewer = new Reviewer({ exec, folders: () => [primary], file: path.join(root, "watched.json"), log: () => undefined, now: () => SENT, removals });
  const listing = await reviewer.list(github, "", false);
  assert.deepEqual(Object.fromEntries(listing.requested.map((p) => [p.number, p.place?.finishedSessions])), { 5: ["posted"], 6: undefined, 7: undefined });
  // Every session sent its review, whether it has posted it or not.
  assert.deepEqual(Object.fromEntries(listing.requested.map((p) => [p.number, p.place?.reviewSessions])), { 5: ["posted"], 6: ["earlier"], 7: ["other"] });
});
