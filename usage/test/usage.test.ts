import assert from "node:assert/strict";
import { test } from "node:test";
import { execError, fakeContext, loadDaemon } from "../../test/daemon.ts";
import { forget, KEEP_MS, limitsOf, readLimits, REQUESTS, SCRIPT } from "../src/daemon/usage.ts";
import type { UsageLimits } from "../src/types.ts";

/** What Claude Code 2.1.325 answered to get_usage on a Claude.ai plan without a 5-hour limit (fields cut down). */
const ANSWER = {
  type: "control_response",
  response: {
    subtype: "success",
    request_id: "usage",
    response: {
      session: { total_cost_usd: 0, model_usage: {} },
      subscription_type: "max",
      rate_limits_available: true,
      rate_limits: {
        five_hour: null,
        seven_day: { utilization: 36, resets_at: "2026-11-18T08:00:00.027769+00:00", limit_dollars: null },
        seven_day_opus: null,
        seven_day_sonnet: null,
        tangelo: null,
        limits: [{ kind: "weekly_all", group: "weekly", percent: 36, resets_at: "2026-11-18T08:00:00.027769+00:00" }],
        model_scoped: [{ display_name: "Fable", utilization: 0, resets_at: "2026-11-18T08:00:00+00:00" }],
      },
      behaviors: null,
    },
  },
};
const INIT = { type: "control_response", response: { subtype: "success", request_id: "init", response: { commands: [{ name: "usage" }] } } };
const out = (...messages: unknown[]) => `${messages.map((m) => JSON.stringify(m)).join("\n")}\n`;

/** Waits until `ok()` holds (readLimits makes the folder before it runs Claude Code). */
async function until(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(ok());
}

test("limitsOf reads the weekly limits, the models' and the 5-hour one from get_usage's answer", () => {
  assert.deepEqual(limitsOf(out(INIT, ANSWER), 1000), {
    at: 1000,
    available: true,
    sevenDay: { percent: 36, resetsAt: Date.parse("2026-11-18T08:00:00.027Z") },
    models: [{ name: "Fable", percent: 0, resetsAt: Date.parse("2026-11-18T08:00:00Z") }],
  });
  const withFiveHour = structuredClone(ANSWER);
  Object.assign(withFiveHour.response.response.rate_limits, { five_hour: { utilization: 12.5, resets_at: "2026-11-14T20:00:00+00:00" } });
  assert.deepEqual(limitsOf(out(withFiveHour), 1).fiveHour, { percent: 12.5, resetsAt: Date.parse("2026-11-14T20:00:00Z") });
});

test("limitsOf tells an account without a Claude.ai plan from an answer it cannot read", () => {
  const apiKey = structuredClone(ANSWER) as { response: { response: Record<string, unknown> } };
  apiKey.response.response.rate_limits_available = false;
  apiKey.response.response.rate_limits = null;
  assert.deepEqual(limitsOf(out(apiKey), 5), { at: 5, available: false, models: [] });

  const unread = structuredClone(apiKey);
  unread.response.response.rate_limits_available = true;
  assert.throws(() => limitsOf(out(unread), 5), /Claude\.ai から使用量を読めませんでした/);

  const empty = structuredClone(ANSWER) as { response: { response: { rate_limits: Record<string, unknown> } } };
  empty.response.response.rate_limits = { five_hour: null, seven_day: null, model_scoped: [{ display_name: "Fable", utilization: null, resets_at: null }] };
  assert.throws(() => limitsOf(out(empty), 5), /答えに上限がありませんでした/);
});

test("limitsOf passes over what is not its answer, and says when there is none", () => {
  const noise = 'not json "usage"\n{"type":"system","subtype":"init","usage":1}\n';
  assert.equal(limitsOf(noise + out(ANSWER), 1).sevenDay?.percent, 36);
  assert.throws(() => limitsOf(out(INIT), 1), /get_usage に答えませんでした/);
  const failed = { type: "control_response", response: { subtype: "error", request_id: "usage", error: "get_usage is not supported in this context" } };
  assert.throws(() => limitsOf(out(failed), 1), /週の上限を読めませんでした（get_usage is not supported in this context）/);
});

test("the requests are what Claude Code's stream-json takes, and the shell gets them from the environment", () => {
  assert.deepEqual(JSON.parse(REQUESTS.INIT), { type: "control_request", request_id: "init", request: { subtype: "initialize" } });
  assert.deepEqual(JSON.parse(REQUESTS.USAGE), { type: "control_request", request_id: "usage", request: { subtype: "get_usage", skip_behaviors: true } });
  assert.match(SCRIPT, /^printf '%s\\n%s\\n' "\$INIT" "\$USAGE" \| "\$CLAUDE" -p --input-format stream-json --output-format stream-json/);
  assert.ok(SCRIPT.includes("--no-session-persistence"));
});

test("readLimits starts one Claude Code for calls that come together, and keeps the answer for a while", async () => {
  forget();
  const calls: { command: string; args: string[]; env?: Record<string, string>; cwd?: string }[] = [];
  let release: () => void = () => undefined;
  const exec = async (command: string, args: string[], o: { env?: Record<string, string>; cwd?: string } = {}) => {
    calls.push({ command, args, env: o.env, cwd: o.cwd });
    await new Promise<void>((r) => (release = r));
    return { stdout: out(INIT, ANSWER), stderr: "" };
  };
  let clock = 1_000_000;
  const o = { exec: exec as never, dataDir: "/tmp", claude: "/opt/claude", now: () => clock };
  const both = Promise.all([readLimits(o), readLimits(o)]);
  await until(() => calls.length === 1);
  release();
  const [a, b] = await both;
  assert.equal(calls.length, 1);
  assert.equal(a, b);
  assert.deepEqual(calls[0]?.args, ["-c", SCRIPT]);
  assert.equal(calls[0]?.command, "sh");
  assert.equal(calls[0]?.cwd, "/tmp");
  assert.deepEqual(calls[0]?.env, { ...REQUESTS, CLAUDE: "/opt/claude" });

  clock += KEEP_MS - 1;
  assert.equal(await readLimits(o), a);
  assert.equal(calls.length, 1);
  clock += 2;
  const again = readLimits(o);
  await until(() => calls.length === 2);
  release();
  await again;
  assert.equal(calls.length, 2);
  forget();
});

test("readLimits says why Claude Code could not be asked", async () => {
  forget();
  const fail = (e: object) => ({ exec: (async () => Promise.reject(Object.assign(new Error("failed"), e))) as never, dataDir: "/tmp", now: () => 1 });
  await assert.rejects(readLimits(fail({ code: 127, stdout: "", stderr: "sh: 1: claude: not found" })), /Claude Code が見つかりません/);
  await assert.rejects(readLimits(fail({ killed: true, stdout: "", stderr: "" })), /時間内に読めませんでした/);
  await assert.rejects(readLimits(fail({ code: 1, stdout: "", stderr: "Error: not logged in\nmore" })), /週の上限を読めませんでした（Error: not logged in）/);
  forget();
});

test("the daemon part's limits asks Claude Code in the plugin's own folder, and tells the person why it could not", async () => {
  forget();
  const daemon = await loadDaemon("usage");
  const { ctx, calls } = fakeContext({ run: () => out(INIT, ANSWER) });
  const { at, ...limits } = (await daemon.call("limits", undefined, ctx)) as UsageLimits;
  assert.equal(typeof at, "number");
  assert.deepEqual(limits, {
    available: true,
    sevenDay: { percent: 36, resetsAt: Date.parse("2026-11-18T08:00:00.027Z") },
    models: [{ name: "Fable", percent: 0, resetsAt: Date.parse("2026-11-18T08:00:00Z") }],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "sh");
  // In its own folder, where gasho-daemon does not take the Claude Code for a session.
  assert.equal((calls[0]?.options as { cwd?: string }).cwd, ctx.dataDir);

  forget();
  const missing = fakeContext({ run: () => execError({ code: 127, stderr: "sh: 1: claude: not found" }) });
  await assert.rejects(daemon.call("limits", undefined, missing.ctx), { message: "Claude Code が見つかりません（gasho-daemon の GASHO_CLAUDE_BIN）。", user: true });
  forget();
});
