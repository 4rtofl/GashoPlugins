import assert from "node:assert/strict";
import { test } from "node:test";
import { execError, fakeContext, loadDaemon } from "../../test/daemon.ts";
import { aroundOf, argsOf, contextCharsOf, MEANING_CHARS } from "../src/daemon/explain.ts";
import { CONTEXT, MAX_WORD } from "../src/word.ts";

const answer = (result: string, more: object = {}) => JSON.stringify({ type: "result", subtype: "success", is_error: false, result, ...more });
const promptIn = (args: string[]) => args[args.indexOf("-p") + 1]!;
const passageIn = (args: string[]) => /<passage>\n([\s\S]*)\n<\/passage>/.exec(promptIn(args))?.[1];

test("gives the word half of the rest before it and half after, and the other side what one side lacks", () => {
  const a = "a".repeat(1000);
  const b = "b".repeat(1000);
  assert.deepEqual(aroundOf(a, "word", b, 14), { before: "aaaaa", after: "bbbbb" });
  assert.deepEqual(aroundOf("aa", "word", b, 14), { before: "aa", after: "bbbbbbbb" });
  assert.deepEqual(aroundOf(a, "word", "bb", 14), { before: "aaaaaaaa", after: "bb" });
  assert.deepEqual(aroundOf("aa", "word", "bb", 14), { before: "aa", after: "bb" });
  // Fewer characters than the word: the word alone.
  assert.deepEqual(aroundOf(a, "word", b, 0), { before: "", after: "" });
});

test("does not cut an emoji's surrogate pair in two", () => {
  // "😀" is two string characters: a cut in it would leave half.
  assert.deepEqual(aroundOf("x😀ab", "w", "cd😀y", 6), { before: "ab", after: "cd" });
  assert.deepEqual(aroundOf("😀ab", "w", "", 4), { before: "ab", after: "" });
});

test("the setting contextChars is a whole number in its range, its default when not a number", () => {
  assert.equal(contextCharsOf(undefined), CONTEXT.default);
  assert.equal(contextCharsOf("600"), CONTEXT.default);
  assert.equal(contextCharsOf(250.4), 250);
  assert.equal(contextCharsOf(-1), CONTEXT.min);
  assert.equal(contextCharsOf(1e9), CONTEXT.max);
});

test("runs Claude Code without tools, hooks or a saved session, with a system prompt of its own", () => {
  const args = argsOf("p", "haiku");
  for (const a of ["--tools", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence", "--system-prompt"]) assert.ok(args.includes(a), a);
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.match(args[args.indexOf("--settings") + 1]!, /"disableAllHooks":true/);
});

test("meaning asks Claude Code in the plugin's folder about the word marked in the text around it, by the settings", async () => {
  const daemon = await loadDaemon("word-meaning");
  const { ctx, calls } = fakeContext({ settings: { model: "sonnet", contextChars: 14 }, run: () => answer("  同じ処理を何度しても\n結果が変わらないこと。 ") });
  const params = { word: "冪等", before: "これは前の文です。この処理は", after: "なので、二度呼んでも同じです。" };
  assert.deepEqual(await daemon.call("meaning", params, ctx), { meaning: "同じ処理を何度しても 結果が変わらないこと。" });
  const args = calls[0]!.args;
  assert.equal((calls[0]!.options as { cwd?: string }).cwd, ctx.dataDir);
  assert.equal(args[args.indexOf("--model") + 1], "sonnet");
  // 14 characters with the word, and "…" where the text was cut.
  assert.equal(passageIn(args), "…。この処理は<selected>冪等</selected>なので、二度…");
  assert.ok(promptIn(args).includes('what "冪等" means'));

  // The settings are read at each call: they change while the daemon part runs.
  ctx.settings.contextChars = 1000;
  delete ctx.settings.model;
  await daemon.call("meaning", params, ctx);
  assert.equal(passageIn(calls[1]!.args), "これは前の文です。この処理は<selected>冪等</selected>なので、二度呼んでも同じです。");
  assert.equal(calls[1]!.args[calls[1]!.args.indexOf("--model") + 1], "haiku");
});

test("meaning takes only a word and the text around it up to the most the setting can ask for", async () => {
  const daemon = await loadDaemon("word-meaning");
  const { ctx } = fakeContext();
  const ok = { word: "語", before: "", after: "" };
  await assert.rejects(daemon.call("meaning", { ...ok, word: "x".repeat(MAX_WORD + 1) }, ctx), { message: "選んだ語が正しくありません。" });
  await assert.rejects(daemon.call("meaning", { ...ok, word: "一行目\n二行目" }, ctx), { message: "選んだ語が正しくありません。" });
  await assert.rejects(daemon.call("meaning", { ...ok, word: " " }, ctx), { message: "選んだ語が正しくありません。" });
  await assert.rejects(daemon.call("meaning", { word: "語" }, ctx), { message: "語の前後の文が正しくありません。" });
  await assert.rejects(daemon.call("meaning", { ...ok, after: "x".repeat(CONTEXT.max + 1) }, ctx), { message: "語の前後の文が正しくありません。" });
});

test("meaning says why there is no meaning, and cuts a long one", async () => {
  const daemon = await loadDaemon("word-meaning");
  const params = { word: "語", before: "", after: "" };
  let out: string | Error = execError({ killed: true });
  const { ctx } = fakeContext({ run: () => out });
  await assert.rejects(daemon.call("meaning", params, ctx), { message: "意味を、時間内に調べられませんでした。" });
  out = execError({ code: "ENOENT" });
  await assert.rejects(daemon.call("meaning", params, ctx), { message: "Claude Code が見つかりません（gasho-daemon の GASHO_CLAUDE_BIN）。" });
  out = execError({ stderr: "Invalid API key\nmore" });
  await assert.rejects(daemon.call("meaning", params, ctx), { message: "意味を調べられませんでした（Invalid API key）。" });
  // As Claude Code fails when it is not logged in: exit 1, why in the JSON on stdout, nothing on stderr.
  out = execError({ code: 1, stdout: answer("Not logged in · Please run /login", { is_error: true }) });
  await assert.rejects(daemon.call("meaning", params, ctx), { message: "意味を調べられませんでした（Not logged in · Please run /login）。" });
  out = answer("Credit balance is too low", { is_error: true });
  await assert.rejects(daemon.call("meaning", params, ctx), { message: "意味を調べられませんでした（Credit balance is too low）。" });
  out = answer(" ");
  await assert.rejects(daemon.call("meaning", params, ctx), { message: "Claude Code が意味を答えませんでした。" });
  out = "not json";
  await assert.rejects(daemon.call("meaning", params, ctx), { message: "Claude Code の答えを読めませんでした。" });
  out = answer("あ".repeat(MEANING_CHARS + 10));
  assert.deepEqual(await daemon.call("meaning", params, ctx), { meaning: `${"あ".repeat(MEANING_CHARS)}…` });
});
