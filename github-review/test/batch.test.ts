import assert from "node:assert/strict";
import { test } from "node:test";
import type { MachineInfo } from "@gasho/plugin-sdk";
import { batchSummary, reviewAll, type BatchStep, type Item, type Notice, type Spot, type Tools } from "../src/web/actions.ts";
import { attachBatchPage, batchBusy, batchRun, hideBatch, startBatch } from "../src/web/batch-run.ts";
import type { Created } from "../src/types.ts";

const TEMPLATE = { name: "レビューする", body: "#{number} をレビュー" };
const dirOf = (n: number) => `/w/r/review-r-${n}`;

/**
 * A fake of what "まとめてレビューさせる" uses, for pull requests #1, #2… of o/r on one working server. Claude Code does
 * not trust their folders yet; `warned` are the numbers whose folder it has warnings about. Making the worktree of
 * `hold` waits for `release()`.
 */
function fakeBatch(opts: { count?: number; existing?: number[]; notes?: Record<number, string>; warned?: number[]; sendWarning?: number[]; sendFail?: number[]; features?: string[]; answers?: boolean[]; hold?: number } = {}) {
  const machine = { id: "m1", name: "m1", canLaunch: true, features: opts.features ?? ["effort"], sessions: [] } as unknown as MachineInfo;
  const items = Array.from({ length: opts.count ?? 3 }, (_, i) => {
    const number = i + 1;
    const pr = { repo: "o/r", number, title: `PR ${number}`, url: `https://github.com/o/r/pull/${number}`, branch: `feat-${number}` } as Item["pr"];
    const spot: Spot = { machine, primary: "/w/r" };
    return { item: { pr, spots: [spot] } as Item, spot };
  });
  const trusted = new Set<string>();
  const log: string[] = [];
  const asked: { path: string; warnings: string[] }[] = [];
  const answers = [...(opts.answers ?? [])];
  const notices: (Notice | undefined)[] = [];
  const steps: Record<string, BatchStep[]> = {};
  const numberOf = (cwd: string) => Number(cwd.split("-").pop());
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  const tools = {
    call: (async ({ method, params }: { method: string; params: { number: number; action?: string; sessionId?: string } }) => {
      if (method === "reviewSession") {
        log.push(`reviewSession ${params.action} ${params.sessionId}`);
        return { ok: true, data: {} };
      }
      if (method === "trackReview") {
        log.push(`trackReview ${params.sessionId} #${params.number}`);
        return { ok: true, data: { ok: true } };
      }
      if (params.number === opts.hold) await held;
      log.push(`create #${params.number}`);
      const note = opts.notes?.[params.number];
      return { ok: true, data: { path: dirOf(params.number), created: !opts.existing?.includes(params.number), ...(note ? { note } : {}) } satisfies Created };
    }) as unknown as Tools["call"],
    launch: (async ({ cwd, trust }: { cwd: string; trust?: boolean }) => {
      if (!trusted.has(cwd) && !trust) {
        log.push(`launch #${numberOf(cwd)}: needs trust`);
        return { ok: false, error: "信頼されていません", needsTrust: true, trustWarnings: opts.warned?.includes(numberOf(cwd)) ? ["⚠ 設定があります"] : [] };
      }
      trusted.add(cwd);
      log.push(`launch #${numberOf(cwd)}${trust ? " (trust)" : ""}`);
      return { ok: true, sessionId: `s-${numberOf(cwd)}` };
    }) as unknown as Tools["launch"],
    send: (async ({ sessionId, text, effort }: { sessionId: string; text: string; effort?: string }) => {
      log.push(`send ${sessionId} effort=${effort ?? "-"}: ${text.split("\n")[0]}`);
      const n = Number(sessionId.slice(2));
      if (opts.sendFail?.includes(n)) return { ok: false, error: "送れません" };
      return { ok: true, data: { queued: false, ...(opts.sendWarning?.includes(n) ? { warning: "Effort を Max にできませんでした。いまの Effort のまま送ります。" } : {}) } };
    }) as Tools["send"],
    remove: (async () => ({ ok: true })) as unknown as Tools["remove"],
    removeSession: (async () => ({ ok: true })) as unknown as Tools["removeSession"],
    nav: {} as Tools["nav"],
    actions: {
      notify: (n) => notices.push(n),
      askFork: async () => false,
      askTrust: async (q) => {
        asked.push(q);
        return answers.shift() ?? true;
      },
      askRemove: async () => false,
      askAgentFor: async () => undefined,
      reload: (id) => log.push(`reload ${id}`),
      refresh: async () => {},
    },
  } satisfies Tools;
  const onStep = (url: string, step: BatchStep) => (steps[`#${url.split("/").pop()}`] ??= []).push(step);
  return { machine, items, tools, log, asked, notices, steps, onStep, release, last: () => notices.at(-1) };
}

test("batch: each one is sent the template at the effort level of a review; a warning in sending goes in its result", async () => {
  const f = fakeBatch({ count: 2, sendWarning: [2] });
  const count = await reviewAll(f.items, TEMPLATE, f.tools, f.onStep);
  assert.deepEqual(
    f.log.filter((l) => l.startsWith("send")),
    ["send s-1 effort=high: #1 をレビュー", "send s-2 effort=high: #2 をレビュー"],
  );
  assert.deepEqual(f.steps["#1"]?.at(-1), { state: "done", sessionId: "s-1" });
  assert.deepEqual(f.steps["#2"]?.at(-1), { state: "done", sessionId: "s-2", text: "Effort を Max にできませんでした。いまの Effort のまま送ります。" });
  assert.deepEqual(count, { done: 2, failed: 0, skipped: 0, warned: 1 });
  assert.deepEqual(batchSummary(count, 2), { text: "2 件のうち 2 件でレビューを始めました（1 件は送るときに注意が出ました）。", tone: "danger" });
});

test("batch: how a worktree was made otherwise than usual goes in its result", async () => {
  const detached = "ローカルのブランチ feat-1 に origin に無い commit があるので、そのままにして、origin の feat-1 を detached HEAD で取ってきました。";
  const f = fakeBatch({ count: 2, notes: { 1: detached, 2: detached }, sendWarning: [2] });
  await reviewAll(f.items, TEMPLATE, f.tools, f.onStep);
  assert.deepEqual(f.steps["#1"]?.at(-1), { state: "done", sessionId: "s-1", text: detached });
  assert.deepEqual(f.steps["#2"]?.at(-1), { state: "done", sessionId: "s-2", text: `Effort を Max にできませんでした。いまの Effort のまま送ります。 ${detached}` });
});

test("batch: a session is tracked before its review is sent, and forgotten when the review did not go", async () => {
  const f = fakeBatch({ count: 2, sendFail: [2] });
  const count = await reviewAll(f.items, TEMPLATE, f.tools, f.onStep);
  assert.deepEqual(
    f.log.filter((l) => /^(send|reviewSession)/.test(l)),
    ["reviewSession track s-1", "send s-1 effort=high: #1 をレビュー", "reviewSession track s-2", "send s-2 effort=high: #2 をレビュー", "reviewSession forget s-2"],
  );
  assert.deepEqual(count, { done: 1, failed: 1, skipped: 0, warned: 0 });
});

test("batch: where gasho-daemon cannot switch the effort level, the template goes as it is", async () => {
  const f = fakeBatch({ count: 1, features: ["model"] });
  const count = await reviewAll(f.items, TEMPLATE, f.tools, f.onStep);
  assert.deepEqual(
    f.log.filter((l) => l.startsWith("send")),
    ["send s-1 effort=-: #1 をレビュー"],
  );
  assert.deepEqual(batchSummary(count, 1), { text: "1 件のうち 1 件でレビューを始めました。" });
});

test("batch: each review is tracked for its finished notification before it is sent", async () => {
  const f = fakeBatch({ count: 2 });
  await reviewAll(f.items, TEMPLATE, f.tools, f.onStep);
  assert.deepEqual(
    f.log.filter((l) => /^(reviewSession|trackReview|send)/.test(l)),
    [
      "reviewSession track s-1",
      "trackReview s-1 #1",
      "send s-1 effort=high: #1 をレビュー",
      "reviewSession track s-2",
      "trackReview s-2 #2",
      "send s-2 effort=high: #2 をレビュー",
    ],
  );
});

test("batch: trust is asked on the first folder; after a yes, folders with no warnings are trusted without asking, ones with warnings are asked", async () => {
  const f = fakeBatch({ count: 3, warned: [2] });
  await reviewAll(f.items, TEMPLATE, f.tools, f.onStep);
  assert.deepEqual(
    f.asked.map((q) => [q.path, q.warnings.length]),
    [
      [dirOf(1), 0],
      [dirOf(2), 1],
    ],
  );
  assert.deepEqual(
    ["#1", "#2", "#3"].map((n) => f.steps[n]?.at(-1)?.state),
    ["done", "done", "done"],
  );
  // While the person is asked, the notice of how far it is hides; it is back once they say yes.
  const two = "2 / 3：#2 のレビューを用意しています…";
  assert.deepEqual(
    f.notices.map((n) => n?.text ?? null),
    ["1 / 3：#1 のレビューを用意しています…", null, "1 / 3：#1 のレビューを用意しています…", two, null, two, "3 / 3：#3 のレビューを用意しています…"],
  );
  // The list is read again after each worktree is made, so that a row done shows it.
  assert.deepEqual(
    f.log.filter((l) => /^(create|reload)/.test(l)),
    ["create #1", "reload m1", "create #2", "reload m1", "create #3", "reload m1"],
  );
});

test("batch: a no to trusting leaves that worktree with no session and goes on; one there already is skipped", async () => {
  const f = fakeBatch({ count: 3, existing: [3], answers: [false] });
  const count = await reviewAll(f.items, TEMPLATE, f.tools, f.onStep);
  assert.deepEqual(f.steps["#1"]?.at(-1), { state: "failed", text: "フォルダーを信頼しなかったので、セッションを起動しませんでした（worktree は作りました）。" });
  // Nobody said yes yet: the next folder is asked about too.
  assert.deepEqual(
    f.asked.map((q) => q.path),
    [dirOf(1), dirOf(2)],
  );
  assert.equal(f.steps["#2"]?.at(-1)?.state, "done");
  assert.deepEqual(f.steps["#3"]?.at(-1), { state: "skipped", text: "worktree（review-r-3）がもうあるので、作りませんでした。" });
  assert.deepEqual(count, { done: 1, failed: 1, skipped: 1, warned: 0 });
  assert.equal(batchSummary(count, 3).text, "3 件のうち 1 件でレビューを始めました（1 件は飛ばしました、1 件はできませんでした）。");
});

/** Waits for the run (outside the page) to get where `ok` says. */
async function until(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 1000 && !ok(); i++) await new Promise((r) => setImmediate(r));
  assert.ok(ok());
}

const stateOf = (n: number) => batchRun()?.steps[`https://github.com/o/r/pull/${n}`]?.state;

test("run: with no review page open, a folder to ask about waits in the run; the page that comes back asks, and it goes on", async () => {
  const f = fakeBatch({ count: 3, warned: [2] });
  startBatch({ machine: f.machine, template: TEMPLATE, targets: f.items }, f.items, f.tools);
  assert.equal(batchRun()?.shown, true);
  assert.deepEqual(batchBusy(batchRun()), f.items.map((x) => x.item.pr.url));
  // No page: the first folder's question waits.
  await until(() => batchRun()?.trust !== undefined);
  assert.equal(batchRun()?.trust?.path, dirOf(1));
  assert.equal(stateOf(1), "working");
  assert.equal(stateOf(2), "waiting");
  batchRun()?.trust?.answer(true);
  // #2's folder has warnings: asked again, while #1 is done and its row free.
  await until(() => batchRun()?.trust?.path === dirOf(2));
  assert.equal(stateOf(1), "done");
  assert.deepEqual(batchBusy(batchRun()), [2, 3].map((n) => `https://github.com/o/r/pull/${n}`));
  batchRun()?.trust?.answer(true);
  await until(() => batchRun()?.running === false);
  assert.deepEqual([1, 2, 3].map(stateOf), ["done", "done", "done"]);
  assert.equal(batchRun()?.trust, undefined);
  assert.deepEqual(batchBusy(batchRun()), []);
  // #3's folder had no warnings: trusted without asking.
  assert.ok(f.log.includes("launch #3 (trust)"));
  assert.ok(f.log.includes("reload m1"));
});

test("run: the notice goes to the page open now; one that comes back gets how far it is, or how it went once", async () => {
  const f = fakeBatch({ count: 2 });
  const shown: (Notice | undefined)[] = [];
  const leave = attachBatchPage((n) => shown.push(n));
  startBatch({ machine: f.machine, template: TEMPLATE, targets: f.items }, f.items, f.tools);
  await until(() => batchRun()?.trust !== undefined);
  assert.equal(shown.at(-1), undefined);
  assert.equal(shown.at(-2)?.text, "1 / 2：#1 のレビューを用意しています…");
  // The page goes (a session opened): the run goes on without it.
  leave();
  batchRun()?.trust?.answer(true);
  await until(() => batchRun()?.running === false);
  const away = shown.length;
  // The page comes back after it ended: how it went, once, with a button to see each one's result.
  const back: (Notice | undefined)[] = [];
  const leaveAgain = attachBatchPage((n) => back.push(n));
  assert.equal(shown.length, away);
  assert.equal(back.length, 1);
  assert.equal(back[0]?.text, "2 件のうち 2 件でレビューを始めました。");
  hideBatch();
  assert.equal(batchRun()?.shown, false);
  back[0]?.action?.run();
  assert.equal(batchRun()?.shown, true);
  leaveAgain();
  const later: (Notice | undefined)[] = [];
  attachBatchPage((n) => later.push(n))();
  assert.deepEqual(later, []);
});

test("run: a page that comes back while it runs gets how far it is", async () => {
  const f = fakeBatch({ count: 2, hold: 2 });
  startBatch({ machine: f.machine, template: TEMPLATE, targets: f.items }, f.items, f.tools);
  await until(() => batchRun()?.trust !== undefined);
  batchRun()?.trust?.answer(true);
  await until(() => stateOf(1) === "done");
  const back: (Notice | undefined)[] = [];
  const leave = attachBatchPage((n) => back.push(n));
  assert.deepEqual(back, [{ text: "2 / 2：#2 のレビューを用意しています…", busy: true }]);
  // One run at a time.
  startBatch({ machine: f.machine, template: TEMPLATE, targets: f.items.slice(0, 1) }, f.items.slice(0, 1), f.tools);
  assert.equal(batchRun()?.targets.length, 2);
  f.release();
  await until(() => batchRun()?.running === false);
  assert.equal(back.at(-1)?.text, "2 件のうち 2 件でレビューを始めました。");
  leave();
});
