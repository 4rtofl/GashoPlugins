import assert from "node:assert/strict";
import { test } from "node:test";
import type { MachineInfo, SessionInfo } from "@gasho/plugin-sdk";
import type { CleanupKind } from "../src/cleanup.ts";
import { askAgent, createWorktree, followCleanup, newSessionIn, openWorktree, removeFinishedSession, reviewIn, type ForkQuestion, type Item, type Notice, type Spot, type Tools } from "../src/web/actions.ts";
import type { Created, ProjectFiles } from "../src/types.ts";

const PR = { repo: "o/r", number: 5, title: "直す", url: "https://github.com/o/r/pull/5", branch: "feat/5-fix" } as Item["pr"];
const DIR = "/w/r/review-5";

/** A fake of what the page gives the row's buttons, keeping what they did. */
function fake(
  opts: {
    created?: boolean;
    launch?: "ok" | "fail";
    send?: "ok" | "fail" | "warn";
    sessions?: Partial<SessionInfo>[];
    claimed?: boolean;
    removeSession?: "fail";
    /** A pull request from a fork, whose worktree has these of PROJECT_FILES (none: it cannot be read). */
    fork?: { files?: string[]; start: boolean };
  } = {},
) {
  const steps: string[] = [];
  const tracked: unknown[] = [];
  const removed: string[] = [];
  const notices: (Notice | undefined)[] = [];
  const methods: string[] = [];
  const asked: ForkQuestion[] = [];
  const opened: string[] = [];
  const sent: string[] = [];
  const launched: string[] = [];
  const efforts: (string | undefined)[] = [];
  const calls: unknown[] = [];
  const machine = { id: "m1", name: "m1", canLaunch: true, features: ["effort"], sessions: (opts.sessions ?? []) as SessionInfo[] } as MachineInfo;
  const tools = {
    call: (async ({ method, params }: { method: string; params: { action?: string } }) => {
      methods.push(method);
      if (method === "reviewSession") {
        steps.push(`reviewSession:${params.action}`);
        tracked.push(params);
        return { ok: true, data: { claimed: opts.claimed ?? true } };
      }
      calls.push(params);
      if (method !== "projectFiles") return { ok: true, data: { path: DIR, created: opts.created ?? true } satisfies Created };
      const files = opts.fork?.files;
      return files ? { ok: true, data: { path: DIR, files } satisfies ProjectFiles } : { ok: false, error: "読めません" };
    }) as unknown as Tools["call"],
    launch: (async ({ cwd }: { cwd: string }) => {
      launched.push(cwd);
      return opts.launch === "fail" ? { ok: false, error: "起動できません" } : { ok: true, sessionId: "s-new" };
    }) as unknown as Tools["launch"],
    send: (async ({ sessionId, text, effort }: { sessionId: string; text: string; effort?: string }) => {
      steps.push("send");
      sent.push(`${sessionId}: ${text}`);
      efforts.push(effort);
      if (opts.send === "fail") return { ok: false, error: "送れません" };
      return { ok: true, data: opts.send === "warn" ? { warning: "Effort を切り替えられませんでした。" } : {} };
    }) as Tools["send"],
    remove: (async () => ({ ok: true })) as unknown as Tools["remove"],
    removeSession: (async ({ sessionId }: { sessionId: string }) => {
      removed.push(sessionId);
      return opts.removeSession === "fail" ? { ok: false, error: "削除できません" } : { ok: true };
    }) as Tools["removeSession"],
    nav: { openSession: (machine: string, sessionId: string) => opened.push(`${machine}/${sessionId}`) } as unknown as Tools["nav"],
    actions: {
      notify: (n) => notices.push(n),
      askFork: async (q) => {
        asked.push(q);
        return opts.fork?.start ?? true;
      },
      askTrust: async () => true,
      askRemove: async () => true,
      askAgentFor: async () => ({ cleanup: true }),
      reload: () => {},
    },
  } satisfies Tools;
  const spot: Spot = { machine, primary: "/w/r", worktree: { path: DIR, review: true } as Spot["worktree"] };
  const pr = opts.fork ? { ...PR, fork: true, author: "someone" } : PR;
  return { tools, spot, machine, item: { pr, spots: [spot] } as Item, notices, methods, asked, opened, sent, launched, efforts, calls, steps, tracked, removed, last: () => notices.at(-1) };
}

test("create: starts a session and sends the template, but stays on the page; the notice opens the session", async () => {
  const f = fake();
  await createWorktree(f.item, f.spot, { name: "レビューする", body: "#{number} をレビュー" }, f.tools);
  assert.deepEqual(f.launched, [DIR]);
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0] ?? "", /^s-new: #5 をレビュー\n/);
  assert.deepEqual(f.efforts, ["xhigh"]);
  assert.deepEqual(f.opened, []);
  // A pull request of the same repository is not asked about.
  assert.deepEqual(f.methods, ["create", "reviewSession"]);
  assert.deepEqual(f.asked, []);
  const n = f.last();
  assert.equal(n?.text, "#5 のセッションを起動し、「レビューする」を送りました。");
  assert.equal(n?.busy, undefined);
  assert.equal(n?.action?.label, "セッションを開く");
  n?.action?.run();
  assert.deepEqual(f.opened, ["m1/s-new"]);
});

test("create: with 何も送らない it sends nothing, and stays", async () => {
  const f = fake();
  await createWorktree(f.item, f.spot, undefined, f.tools);
  assert.deepEqual(f.sent, []);
  assert.deepEqual(f.opened, []);
  assert.equal(f.last()?.text, "#5 のセッションを起動しました。");
  assert.equal(f.last()?.action?.label, "セッションを開く");
});

test("create: when the template is not sent, the notice says so and still opens the session", async () => {
  const f = fake({ send: "fail" });
  await createWorktree(f.item, f.spot, { name: "レビューする", body: "x" }, f.tools);
  assert.deepEqual(f.opened, []);
  assert.equal(f.last()?.tone, "danger");
  assert.match(f.last()?.text ?? "", /送れませんでした：送れません/);
  f.last()?.action?.run();
  assert.deepEqual(f.opened, ["m1/s-new"]);
});

test("create: a worktree there already takes the session used last there, sends nothing, and stays", async () => {
  const sessions = [
    { sessionId: "s-old", cwd: DIR, managed: true, lastActivityAt: 1 },
    { sessionId: "s-last", cwd: DIR, managed: true, lastActivityAt: 2 },
  ];
  const f = fake({ created: false, sessions });
  await createWorktree(f.item, f.spot, { name: "レビューする", body: "x" }, f.tools);
  assert.deepEqual(f.launched, []);
  assert.deepEqual(f.sent, []);
  assert.deepEqual(f.opened, []);
  assert.equal(f.last()?.text, "#5 のレビュー用の worktree はもうありました（review-5）。");
  f.last()?.action?.run();
  assert.deepEqual(f.opened, ["m1/s-last"]);
});

test("create: a worktree there already with no Gasho session gets one started, and stays", async () => {
  const f = fake({ created: false });
  await createWorktree(f.item, f.spot, undefined, f.tools);
  assert.deepEqual(f.launched, [DIR]);
  assert.deepEqual(f.opened, []);
  f.last()?.action?.run();
  assert.deepEqual(f.opened, ["m1/s-new"]);
});

test("create: when the session does not start, the notice says why and offers nothing to open", async () => {
  const f = fake({ launch: "fail" });
  await createWorktree(f.item, f.spot, { name: "レビューする", body: "x" }, f.tools);
  assert.deepEqual(f.opened, []);
  assert.equal(f.last()?.text, "起動できません");
  assert.equal(f.last()?.action, undefined);
});

test("open and new session: these buttons still go to the session", async () => {
  const f = fake({ sessions: [{ sessionId: "s-last", cwd: DIR, managed: true }] });
  await openWorktree(f.item, f.spot, f.tools);
  assert.deepEqual(f.opened, ["m1/s-last"]);
  await newSessionIn(f.item, f.spot, f.tools);
  assert.deepEqual(f.opened, ["m1/s-last", "m1/s-new"]);
  assert.equal(f.last(), undefined);
});

test("create: when the effort level could not be switched, it says why and stays; the notice opens the session", async () => {
  const f = fake({ send: "warn" });
  await createWorktree(f.item, f.spot, { name: "レビューする", body: "#{number} をレビュー" }, f.tools);
  assert.deepEqual(f.opened, []);
  const n = f.last();
  assert.equal(n?.text, "「レビューする」を送りました。Effort を切り替えられませんでした。");
  assert.equal(n?.tone, "danger");
  n?.action?.run();
  assert.deepEqual(f.opened, ["m1/s-new"]);
});

test("create: a fork's pull request asks first, with which of .claude/, CLAUDE.md… its worktree has; 起動しない starts nothing and keeps the worktree", async () => {
  const f = fake({ fork: { files: [".claude/", "CLAUDE.md"], start: false } });
  await createWorktree(f.item, f.spot, { name: "レビューする", body: "x" }, f.tools);
  assert.equal(f.asked.length, 1);
  assert.equal(f.asked[0]?.path, DIR);
  assert.deepEqual(f.asked[0]?.files, [".claude/", "CLAUDE.md"]);
  assert.equal(f.asked[0]?.pr.number, 5);
  assert.deepEqual(f.launched, []);
  assert.deepEqual(f.sent, []);
  assert.deepEqual(f.methods, ["create", "projectFiles"]);
  assert.equal(f.last()?.text, "#5 のセッションは起動していません。worktree（review-5）はそのまま残しています。");
  assert.equal(f.last()?.tone, undefined);
});

test("create: a fork's pull request starts and gets the template once the person says 起動する", async () => {
  const f = fake({ fork: { files: [], start: true } });
  await createWorktree(f.item, f.spot, { name: "レビューする", body: "#{number} をレビュー" }, f.tools);
  assert.equal(f.asked.length, 1);
  assert.deepEqual(f.launched, [DIR]);
  assert.match(f.sent[0] ?? "", /^s-new: #5 をレビュー\n/);
});

test("open, new session, レビューする: a session started later in a fork's worktree is asked about too, one there already is not", async () => {
  const f = fake({ fork: { files: [], start: false } });
  await openWorktree(f.item, f.spot, f.tools);
  await newSessionIn(f.item, f.spot, f.tools);
  await reviewIn(f.item, f.spot, { name: "レビューする", body: "x" }, f.tools);
  assert.equal(f.asked.length, 3);
  assert.deepEqual(f.launched, []);
  assert.deepEqual(f.sent, []);
  assert.deepEqual(f.opened, []);

  const g = fake({ fork: { files: [], start: false }, sessions: [{ sessionId: "s-last", cwd: DIR, managed: true }] });
  await openWorktree(g.item, g.spot, g.tools);
  assert.deepEqual(g.asked, []);
  assert.deepEqual(g.opened, ["m1/s-last"]);
});

test("create: when the fork's worktree cannot be read, nothing starts and the notice says why", async () => {
  const f = fake({ fork: { start: true } });
  await createWorktree(f.item, f.spot, undefined, f.tools);
  assert.deepEqual(f.asked, []);
  assert.deepEqual(f.launched, []);
  assert.equal(f.last()?.text, "読めません");
  assert.equal(f.last()?.tone, "danger");
});

test("follow: what may be removed is kept; any other ask forgets the one before it", async () => {
  const asked = async (kind: CleanupKind, cleanup: boolean, worktree: { path: string; review: boolean }) => {
    const f = fake();
    await followCleanup(f.item, { ...f.spot, worktree }, kind, cleanup, f.tools);
    return f.calls;
  };
  const named = { path: "/w/r/my-work", review: false };
  const review = { path: DIR, review: true };
  const follow = (kind: CleanupKind) => [{ repo: "o/r", number: 5, action: "follow", kind }];
  const forget = [{ repo: "o/r", number: 5, action: "forget" }];

  assert.deepEqual(await asked("merge", true, named), follow("merge"));
  assert.deepEqual(await asked("merge", true, review), follow("merge"));
  assert.deepEqual(await asked("sendBack", true, review), follow("sendBack"));
  assert.deepEqual(await asked("merge", false, named), forget);
  // A send-back from a worktree not made for the review: "マージしてもらう" asked before it no longer removes the worktree.
  assert.deepEqual(await asked("sendBack", false, named), forget);
  assert.deepEqual(await asked("sendBack", true, named), forget);
  // The primary checkout is never followed.
  assert.deepEqual(await asked("merge", true, { path: "/w/r", review: false }), forget);
});

test("a session is tracked before the review is sent, with the verdict there was; 何も送らない tracks nothing", async () => {
  const f = fake();
  const marked = { ...f.item, pr: { ...PR, mark: { verdict: "changes", sha: "a".repeat(40), url: "https://github.com/o/r/pull/5#old" } } } as Item;
  await createWorktree(marked, f.spot, { name: "レビューする", body: "x" }, f.tools);
  assert.deepEqual(f.steps, ["reviewSession:track", "send"]);
  assert.deepEqual(f.tracked, [{ action: "track", sessionId: "s-new", repo: "o/r", number: 5, before: "https://github.com/o/r/pull/5#old" }]);
  const none = fake();
  await createWorktree(none.item, none.spot, undefined, none.tools);
  assert.deepEqual(none.tracked, []);
});

test("レビューする on my own pull request tracks only the new session, not the one that made the changes", async () => {
  const f = fake({ sessions: [{ sessionId: "s-mine", cwd: DIR, managed: true, status: "idle" }] });
  await reviewIn(f.item, f.spot, { name: "レビューする", body: "x" }, f.tools);
  assert.deepEqual(f.tracked, [{ action: "track", sessionId: "s-new", repo: "o/r", number: 5 }]);
});

test("a session that did not get the review is not removed later", async () => {
  const f = fake({ send: "fail" });
  await createWorktree(f.item, f.spot, { name: "レビューする", body: "x" }, f.tools);
  assert.deepEqual(f.steps, ["reviewSession:track", "send", "reviewSession:forget"]);
});

test("a session asked for more than the review is not removed when the review is posted", async () => {
  const f = fake({ sessions: [{ sessionId: "s1", cwd: DIR, managed: true, status: "busy" }] });
  assert.equal(await askAgent(f.item, f.spot, "マージしてもらう", "マージして", "medium", f.tools), true);
  assert.deepEqual(f.steps, ["reviewSession:forget", "send"]);
  assert.deepEqual(f.tracked, [{ action: "forget", sessionId: "s1" }]);
});

test("a finished session is removed once, by the page that claimed it, and says so", async () => {
  const f = fake();
  await removeFinishedSession(PR, f.machine, "s1", f.tools);
  assert.deepEqual(f.removed, ["s1"]);
  assert.deepEqual(f.steps, ["reviewSession:claim", "reviewSession:forget"]);
  assert.match(f.last()?.text ?? "", /#5 のレビューの結果を投稿したので、セッションを削除しました/);

  const other = fake({ claimed: false });
  await removeFinishedSession(PR, other.machine, "s1", other.tools);
  assert.deepEqual(other.removed, []);
  assert.deepEqual(other.notices, []);
});

test("a session that cannot be removed stays, says why, and is not tried again", async () => {
  const f = fake({ removeSession: "fail" });
  await removeFinishedSession(PR, f.machine, "s1", f.tools);
  assert.deepEqual(f.steps, ["reviewSession:claim", "reviewSession:forget"]);
  assert.equal(f.last()?.tone, "danger");
  assert.match(f.last()?.text ?? "", /削除できません/);
});
