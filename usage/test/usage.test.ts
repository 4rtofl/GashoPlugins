import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fakeContext, loadDaemon } from "../../test/daemon.ts";
import { ARGS, askClaude, forget, KEEP_MS, KILL_MS, limitsOf, readLimits, REQUESTS, RUN_MS, type Asked } from "../src/daemon/usage.ts";
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
async function until(ok: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
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

test("limitsOf keeps a limit without a reset time, and the Sonnet week on the plans /usage shows it for", () => {
  const a = structuredClone(ANSWER) as { response: { response: { subscription_type: string | null; rate_limits: Record<string, unknown> } } };
  Object.assign(a.response.response.rate_limits, { five_hour: { utilization: 0, resets_at: null }, seven_day_sonnet: { utilization: 4, resets_at: "2026-11-18T08:00:00Z" } });
  const read = limitsOf(out(a), 1);
  assert.deepEqual(read.fiveHour, { percent: 0 });
  assert.deepEqual(read.sevenDaySonnet, { percent: 4, resetsAt: Date.parse("2026-11-18T08:00:00Z") });
  for (const plan of ["team", null]) {
    a.response.response.subscription_type = plan;
    assert.equal(limitsOf(out(a), 1).sevenDaySonnet?.percent, 4, String(plan));
  }
  a.response.response.subscription_type = "pro";
  assert.equal(limitsOf(out(a), 1).sevenDaySonnet, undefined);
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

test("the requests are what Claude Code's stream-json takes", () => {
  assert.deepEqual(JSON.parse(REQUESTS.INIT), { type: "control_request", request_id: "init", request: { subtype: "initialize" } });
  assert.deepEqual(JSON.parse(REQUESTS.USAGE), { type: "control_request", request_id: "usage", request: { subtype: "get_usage", skip_behaviors: true } });
});

test("the method waits longer than Claude Code is given to answer", () => {
  const manifest = JSON.parse(readFileSync(new URL("../gasho-plugin.json", import.meta.url), "utf8")) as { methods: { limits: { timeoutSeconds: number } } };
  assert.ok(manifest.methods.limits.timeoutSeconds * 1000 > RUN_MS);
});

/**
 * A stand-in for Claude Code: a shell script that writes its arguments and stdin to `log`, prints `printed`, and then
 * waits, with its pid in `pid` (the group's: askClaude starts it in a group of its own) and a child of its own.
 * `deaf`: it and its child ignore SIGTERM.
 */
async function fakeClaude(printed: string, deaf = false): Promise<{ bin: string; dir: string; read: (name: string) => Promise<string> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "usage-test-"));
  await fs.writeFile(path.join(dir, "printed"), printed);
  const bin = path.join(dir, "claude");
  await fs.writeFile(
    bin,
    `#!/bin/sh\n${deaf ? "trap '' TERM\n" : ""}echo $$ > "${dir}/pid"\npwd > "${dir}/cwd"\nprintf '%s\\n' "$@" > "${dir}/args"\nread -r a; read -r b\nprintf '%s\\n%s\\n' "$a" "$b" > "${dir}/stdin"\ncat "${dir}/printed"\nsleep 30 &\necho $! > "${dir}/child"\nwait\n`,
    { mode: 0o755 },
  );
  return { bin, dir, read: (name) => fs.readFile(path.join(dir, name), "utf8") };
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("askClaude gives the answer once Claude Code prints it, while it still runs, and starts it without hooks", async () => {
  const c = await fakeClaude(out(INIT, ANSWER));
  const asked = await askClaude(c.bin, c.dir, 20_000);
  const pid = Number(await c.read("pid"));
  try {
    assert.equal(asked.answer, JSON.stringify(ANSWER));
    assert.ok(alive(pid));
    assert.deepEqual((await c.read("args")).trimEnd().split("\n"), ARGS);
    assert.ok(ARGS.includes('{"disableAllHooks":true}'));
    assert.equal(await c.read("stdin"), `${REQUESTS.INIT}\n${REQUESTS.USAGE}\n`);
  } finally {
    process.kill(-pid, "SIGTERM");
    await fs.rm(c.dir, { recursive: true, force: true });
  }
});

test("askClaude stops Claude Code and what it started when it does not answer in time", async () => {
  const c = await fakeClaude(out(INIT));
  const asked = await askClaude(c.bin, c.dir, 1500);
  try {
    assert.equal(asked.killed, true);
    assert.equal(asked.answer, undefined);
    const child = Number(await c.read("child"));
    await until(() => !alive(child));
  } finally {
    await fs.rm(c.dir, { recursive: true, force: true });
  }
});

test("askClaude stops Claude Code when the call is aborted, with SIGKILL when SIGTERM does not stop it", async () => {
  const c = await fakeClaude(out(INIT), true);
  const abort = new AbortController();
  const asking = askClaude(c.bin, c.dir, 60_000, abort.signal);
  try {
    const written = (name: string) => {
      try {
        return readFileSync(path.join(c.dir, name), "utf8").trim() !== "";
      } catch {
        return false;
      }
    };
    await until(() => written("child"), 1000);
    const pid = Number(await c.read("pid"));
    const child = Number(await c.read("child"));
    abort.abort();
    assert.equal((await asking).killed, true);
    await new Promise((r) => setTimeout(r, 1000));
    assert.ok(alive(pid), "SIGTERM is ignored");
    await until(() => !alive(pid) && !alive(child), KILL_MS / 5 + 400);
  } finally {
    await fs.rm(c.dir, { recursive: true, force: true });
  }
});

test("readLimits starts one Claude Code for calls that come together, and keeps the answer for a while", async () => {
  forget();
  const calls: { claude: string; cwd: string; timeoutMs: number }[] = [];
  let release: () => void = () => undefined;
  const ask = async (claude: string, cwd: string, timeoutMs: number): Promise<Asked> => {
    calls.push({ claude, cwd, timeoutMs });
    await new Promise<void>((r) => (release = r));
    return { answer: JSON.stringify(ANSWER), stderr: "" };
  };
  let clock = 1_000_000;
  const o = { ask, dataDir: "/tmp", claude: "/opt/claude", now: () => clock };
  const both = Promise.all([readLimits(o), readLimits(o)]);
  await until(() => calls.length === 1);
  release();
  const [a, b] = await both;
  assert.equal(calls.length, 1);
  assert.equal(a, b);
  assert.deepEqual(calls[0], { claude: "/opt/claude", cwd: "/tmp", timeoutMs: RUN_MS });

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

test("readLimits says why Claude Code gave no answer", async () => {
  forget();
  const fail = (a: Omit<Asked, "stderr"> & { stderr?: string }) => ({ ask: async (): Promise<Asked> => ({ stderr: "", ...a }), dataDir: "/tmp", now: () => 1 });
  await assert.rejects(readLimits(fail({ code: "ENOENT" })), /Claude Code が見つかりません/);
  await assert.rejects(readLimits(fail({ code: "EACCES" })), { message: "Claude Code を起動できませんでした（gasho-daemon の GASHO_CLAUDE_BIN、EACCES）。" });
  await assert.rejects(readLimits(fail({ killed: true })), /時間内に読めませんでした/);
  await assert.rejects(readLimits(fail({ code: 1, stderr: "Error: not logged in\nmore" })), /週の上限を読めませんでした（Error: not logged in）/);
  await assert.rejects(readLimits(fail({ code: 0 })), /get_usage に答えませんでした/);
  forget();
});

test("the daemon part's limits asks Claude Code in the plugin's own folder, and tells the person why it could not", async () => {
  forget();
  const claude = process.env.GASHO_CLAUDE_BIN;
  const c = await fakeClaude(out(INIT, ANSWER));
  process.env.GASHO_CLAUDE_BIN = c.bin;
  try {
    const daemon = await loadDaemon("usage");
    const { ctx } = fakeContext();
    const { at, ...limits } = (await daemon.call("limits", undefined, ctx)) as UsageLimits;
    assert.equal(typeof at, "number");
    assert.deepEqual(limits, {
      available: true,
      sevenDay: { percent: 36, resetsAt: Date.parse("2026-11-18T08:00:00.027Z") },
      models: [{ name: "Fable", percent: 0, resetsAt: Date.parse("2026-11-18T08:00:00Z") }],
    });
    // In its own folder, where gasho-daemon does not take the Claude Code for a session.
    assert.equal(await fs.realpath((await c.read("cwd")).trim()), await fs.realpath(ctx.dataDir));

    forget();
    process.env.GASHO_CLAUDE_BIN = path.join(c.dir, "missing");
    await assert.rejects(daemon.call("limits", undefined, ctx), { message: "Claude Code が見つかりません（gasho-daemon の GASHO_CLAUDE_BIN）。", user: true });
  } finally {
    if (claude === undefined) delete process.env.GASHO_CLAUDE_BIN;
    else process.env.GASHO_CLAUDE_BIN = claude;
    try {
      process.kill(-Number(await c.read("pid")), "SIGTERM");
    } catch {
      // it has ended
    }
    await fs.rm(c.dir, { recursive: true, force: true });
    forget();
  }
});
