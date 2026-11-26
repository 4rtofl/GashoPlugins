import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { execError, fakeContext, loadDaemon } from "../../test/daemon.ts";
import {
  argsOf,
  CHARS,
  COUNT,
  findTranscript,
  forget,
  LAST_REPLY_CHARS,
  limitsOf,
  MAX_TURNS,
  projectFolder,
  promptOf,
  promptsOf,
  readTail,
  turnsOf,
} from "../src/daemon/predict.ts";

const SID = "0b5e9a52-2f4c-4a57-9d43-2a1c3b4d5e6f";
const line = (m: unknown) => JSON.stringify(m);
const user = (content: unknown, more: object = {}) => line({ type: "user", message: { role: "user", content }, ...more });
const assistant = (...content: unknown[]) => line({ type: "assistant", message: { role: "assistant", content } });
const text = (t: string) => ({ type: "text", text: t });

/** A transcript in a new CLAUDE_CONFIG_DIR, for /work/app. */
async function transcript(lines: string[], cwd = "/work/app"): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "ok-claude-"));
  const dir = path.join(base, "projects", projectFolder(cwd));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${SID}.jsonl`), `${lines.join("\n")}\n`);
  return base;
}

const answer = (result: string) => JSON.stringify({ type: "result", subtype: "success", result });
const DEFAULTS = { count: COUNT.default, chars: CHARS.default };

beforeEach(() => forget());

test("the folder of a session's transcript is its folder with every other character than a letter or a digit as -", () => {
  assert.equal(projectFolder("/home/rg/repos/Gasho.app_x"), "-home-rg-repos-Gasho-app-x");
});

test("finds the transcript where the folder's name says, else in any folder of projects/", async () => {
  const base = await transcript([user("hi")]);
  assert.equal(await findTranscript(SID, "/work/app", base), path.join(base, "projects", "-work-app", `${SID}.jsonl`));
  // A long path's folder is shortened by Claude Code: another name.
  await fs.rename(path.join(base, "projects", "-work-app"), path.join(base, "projects", "-work-ap-1a2b"));
  assert.equal(await findTranscript(SID, "/work/app", base), path.join(base, "projects", "-work-ap-1a2b", `${SID}.jsonl`));
  assert.equal(await findTranscript("../../etc/passwd", "/work/app", base), undefined);
  assert.equal(await findTranscript(SID, "/work/app", path.join(base, "none")), undefined);
});

test("reads the end of a long transcript from the start of a line", async () => {
  const base = await transcript(["x".repeat(100), user("last")]);
  const file = path.join(base, "projects", "-work-app", `${SID}.jsonl`);
  assert.equal(await readTail(file, user("last").length + 10), `${user("last")}\n`);
  assert.equal((await readTail(file)).split("\n").length, 3);
});

test("keeps what the person typed and Claude's texts, and leaves out tools, thinking, commands and subagents", () => {
  const turns = turnsOf(
    [
      line({ type: "mode", mode: "normal" }),
      user("<local-command-caveat>caveat</local-command-caveat>", { isMeta: true }),
      user("<command-name>/model</command-name>"),
      user("<local-command-stdout>Set model</local-command-stdout>"),
      user("テストを足して<system-reminder>secret</system-reminder>"),
      assistant({ type: "thinking", thinking: "hmm" }),
      assistant({ type: "tool_use", id: "t1", name: "Bash", input: {} }),
      user([{ type: "tool_result", tool_use_id: "t1", content: "ok" }]),
      line({ type: "assistant", isSidechain: true, message: { content: [text("subagent")] } }),
      assistant(text("足しました。")),
      assistant(text("コミットしますか？")),
      "not json",
    ].join("\n"),
  );
  assert.deepEqual(turns, [
    { role: "user", text: "テストを足して" },
    { role: "assistant", text: "足しました。\n\nコミットしますか？" },
  ]);
});

test("asks only after a reply of Claude's, with the newest messages and the end of a long reply", () => {
  assert.equal(promptOf([], DEFAULTS), undefined);
  assert.equal(promptOf([{ role: "user", text: "hi" }], DEFAULTS), undefined);
  const turns = Array.from({ length: MAX_TURNS + 2 }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), text: `m${i}` }));
  turns.at(-1)!.text = `${"a".repeat(LAST_REPLY_CHARS)}END`;
  const prompt = promptOf(turns, DEFAULTS)!;
  assert.ok(!prompt.includes("<human>\nm0\n"));
  assert.ok(prompt.includes("<human>\nm2\n"));
  assert.ok(prompt.includes("END\n</agent>"));
  assert.ok(prompt.includes("JSON array"));
});

test("asks for as many prompts and as many characters as the settings say", () => {
  const prompt = promptOf([{ role: "assistant", text: "直しました。" }], { count: 5, chars: 40 })!;
  assert.ok(prompt.includes("Predict the 5 messages"));
  assert.ok(prompt.includes("at most 40 characters"));
  assert.ok(prompt.includes('["...", "...", "...", "...", "..."]'));
});

test("the settings count and maxChars are whole numbers in their ranges, their defaults when not numbers", () => {
  assert.deepEqual(limitsOf({}), { count: 3, chars: 200 });
  assert.deepEqual(limitsOf({ count: "5", maxChars: Number.NaN }), { count: 3, chars: 200 });
  assert.deepEqual(limitsOf({ count: 2.6, maxChars: 0 }), { count: 3, chars: 1 });
  assert.deepEqual(limitsOf({ count: 20, maxChars: 5000 }), { count: 9, chars: 1000 });
});

test("reads the prompts out of Claude Code's answer, as many as the settings say and cut to their length", () => {
  assert.deepEqual(promptsOf(answer('["はい、進めて", "テストも足して", "はい、進めて", 3]'), DEFAULTS), ["はい、進めて", "テストも足して"]);
  assert.deepEqual(promptsOf(answer('```json\n["a", "b", "c", "d"]\n```'), DEFAULTS), ["a", "b", "c"]);
  assert.equal(promptsOf(answer(`["${"x".repeat(CHARS.default + 10)}"]`), DEFAULTS)[0]!.length, CHARS.default + 1);
  assert.deepEqual(promptsOf(answer('["a", "b", "c", "d", "e"]'), { count: 4, chars: 200 }), ["a", "b", "c", "d"]);
  assert.deepEqual(promptsOf(answer('["コミットして", "はい"]'), { count: 3, chars: 3 }), ["コミッ…", "はい"]);
  assert.deepEqual(promptsOf(answer("no idea"), DEFAULTS), []);
  assert.deepEqual(promptsOf(answer("[not json]"), DEFAULTS), []);
  assert.deepEqual(promptsOf("garbage", DEFAULTS), []);
});

test("runs Claude Code without tools, hooks or a saved session", () => {
  const args = argsOf("PROMPT", "haiku");
  assert.deepEqual(args.slice(0, 4), ["-p", "PROMPT", "--model", "haiku"]);
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.ok(args.includes("--no-session-persistence"));
  assert.deepEqual(JSON.parse(args.at(-1)!), { disableAllHooks: true });
});

test("predict runs Claude Code in the plugin's folder once per reply, with the model of the settings", async () => {
  process.env.CLAUDE_CONFIG_DIR = await transcript([user("直して"), assistant(text("直しました。マージしますか？"))]);
  const daemon = await loadDaemon("ok");
  const { ctx, calls } = fakeContext({ session: { cwd: "/work/app", sessionId: SID }, settings: { model: "sonnet" }, run: () => answer('["マージして"]') });
  assert.deepEqual(await daemon.call("predict", { at: 1 }, ctx), { prompts: ["マージして"] });
  assert.deepEqual(await daemon.call("predict", { at: 1 }, ctx), { prompts: ["マージして"] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.args[calls[0]!.args.indexOf("--model") + 1], "sonnet");
  assert.equal((calls[0]!.options as { cwd?: string }).cwd, ctx.dataDir);
  assert.ok(calls[0]!.args[1]!.includes("マージしますか？"));
  await daemon.call("predict", { at: 2 }, ctx);
  assert.equal(calls.length, 2);
});

test("predict runs Claude Code again for the same reply once the settings changed, and keeps to them", async () => {
  process.env.CLAUDE_CONFIG_DIR = await transcript([user("直して"), assistant(text("直しました。マージしますか？"))]);
  const daemon = await loadDaemon("ok");
  const { ctx, calls } = fakeContext({ session: { cwd: "/work/app", sessionId: SID }, run: () => answer('["マージして", "テストを足して", "差分を見せて"]') });
  assert.deepEqual(await daemon.call("predict", { at: 1 }, ctx), { prompts: ["マージして", "テストを足して", "差分を見せて"] });
  ctx.settings.count = 2;
  ctx.settings.maxChars = 5;
  assert.deepEqual(await daemon.call("predict", { at: 1 }, ctx), { prompts: ["マージして", "テストを足…"] });
  assert.equal(calls.length, 2);
  assert.ok(calls[1]!.args[1]!.includes("Predict the 2 messages"));
});

test("predict gives nothing without a transcript or a reply, and says why Claude Code failed", async () => {
  process.env.CLAUDE_CONFIG_DIR = await transcript([user("直して")]);
  const daemon = await loadDaemon("ok");
  const none = fakeContext({ session: { cwd: "/work/app", sessionId: SID } });
  assert.deepEqual(await daemon.call("predict", { at: 1 }, none.ctx), { prompts: [] });
  const other = fakeContext({ session: { cwd: "/work/app", sessionId: "other" } });
  assert.deepEqual(await daemon.call("predict", { at: 1 }, other.ctx), { prompts: [] });
  await assert.rejects(daemon.call("predict", {}, none.ctx), { message: "返答の時刻が正しくありません。" });

  process.env.CLAUDE_CONFIG_DIR = await transcript([user("直して"), assistant(text("直しました。"))]);
  let fail: Error = execError({ killed: true });
  const failing = fakeContext({ session: { cwd: "/work/app", sessionId: SID }, run: () => fail });
  await assert.rejects(daemon.call("predict", { at: 5 }, failing.ctx), { message: "次の指示を、時間内に予測できませんでした。" });
  // A failure is not kept.
  fail = execError({ code: "ENOENT" });
  await assert.rejects(daemon.call("predict", { at: 5 }, failing.ctx), { message: "Claude Code が見つかりません（gasho-daemon の GASHO_CLAUDE_BIN）。" });
  fail = execError({ stderr: "Invalid API key\nmore" });
  await assert.rejects(daemon.call("predict", { at: 5 }, failing.ctx), { message: "次の指示を予測できませんでした（Invalid API key）。" });
});
