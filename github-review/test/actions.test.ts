import assert from "node:assert/strict";
import { test } from "node:test";
import type { MachineInfo, SessionInfo } from "@gasho/plugin-sdk";
import { createWorktree, newSessionIn, openWorktree, type Item, type Notice, type Spot, type Tools } from "../src/web/actions.ts";
import type { Created } from "../src/types.ts";

const PR = { repo: "o/r", number: 5, title: "直す", url: "https://github.com/o/r/pull/5", branch: "feat/5-fix" } as Item["pr"];
const DIR = "/w/r/review-5";

/** A fake of what the page gives the row's buttons, keeping what they did. */
function fake(opts: { created?: boolean; launch?: "ok" | "fail"; send?: "ok" | "fail"; sessions?: Partial<SessionInfo>[] } = {}) {
  const notices: (Notice | undefined)[] = [];
  const opened: string[] = [];
  const sent: string[] = [];
  const launched: string[] = [];
  const machine = { id: "m1", name: "m1", canLaunch: true, sessions: (opts.sessions ?? []) as SessionInfo[] } as MachineInfo;
  const tools = {
    call: (async () => ({ ok: true, data: { path: DIR, created: opts.created ?? true } satisfies Created })) as unknown as Tools["call"],
    launch: (async ({ cwd }: { cwd: string }) => {
      launched.push(cwd);
      return opts.launch === "fail" ? { ok: false, error: "起動できません" } : { ok: true, sessionId: "s-new" };
    }) as unknown as Tools["launch"],
    send: (async ({ sessionId, text }: { sessionId: string; text: string }) => {
      sent.push(`${sessionId}: ${text}`);
      return opts.send === "fail" ? { ok: false, error: "送れません" } : { ok: true, data: undefined };
    }) as Tools["send"],
    nav: { openSession: (machine: string, sessionId: string) => opened.push(`${machine}/${sessionId}`) } as unknown as Tools["nav"],
    actions: {
      notify: (n) => notices.push(n),
      askTrust: async () => true,
      askRemove: async () => true,
      askMerge: async () => true,
      reload: () => {},
    },
  } satisfies Tools;
  const spot: Spot = { machine, primary: "/w/r", worktree: { path: DIR, review: true } as Spot["worktree"] };
  return { tools, spot, item: { pr: PR, spots: [spot] } as Item, notices, opened, sent, launched, last: () => notices.at(-1) };
}

test("create: starts a session and sends the template, but stays on the page; the notice opens the session", async () => {
  const f = fake();
  await createWorktree(f.item, f.spot, { name: "レビューする", body: "#{number} をレビュー" }, f.tools);
  assert.deepEqual(f.launched, [DIR]);
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0] ?? "", /^s-new: #5 をレビュー\n/);
  assert.deepEqual(f.opened, []);
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
  await openWorktree(f.spot, f.tools);
  assert.deepEqual(f.opened, ["m1/s-last"]);
  await newSessionIn(f.spot, f.tools);
  assert.deepEqual(f.opened, ["m1/s-last", "m1/s-new"]);
  assert.equal(f.last(), undefined);
});
