// The meaning of a word selected in one of Claude's answers, in the text around it. A Claude Code started with -p in
// this plugin's own folder (ctx.dataDir, where gasho-daemon does not take it for a session, plugin API 1.4) is asked,
// with no tools and no hooks, and a short system prompt in place of Claude Code's.
import fs from "node:fs/promises";
import { PluginError, type DaemonContext, type ExecError } from "@gasho/plugin-sdk/daemon";
import { CONTEXT, isWord, type Meaning, type MeaningParams } from "../word.ts";

const MODELS = ["haiku", "sonnet"] as const;
/** How long Claude Code may take; the method waits 60 s (gasho-plugin.json). */
const RUN_MS = 50_000;
/** A longer answer is cut: one sentence was asked for. */
export const MEANING_CHARS = 300;

const modelOf = (v: unknown): string => (MODELS.includes(v as (typeof MODELS)[number]) ? (v as string) : "haiku");

/** The setting contextChars, a whole number in its range, its default when it is not a number. */
export const contextCharsOf = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(CONTEXT.max, Math.max(CONTEXT.min, Math.round(v))) : CONTEXT.default;

const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff;
const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;

/**
 * The text given with the word: `chars` characters with the word, half before it and half after; when one side has
 * less, the other gets the rest. An emoji's surrogate pair is not cut in two.
 */
export function aroundOf(before: string, word: string, after: string, chars: number): { before: string; after: string } {
  const room = Math.max(0, chars - word.length);
  const half = Math.floor(room / 2);
  const afterChars = Math.min(after.length, room - Math.min(before.length, half));
  const beforeChars = Math.min(before.length, room - afterChars);
  let from = before.length - beforeChars;
  let to = afterChars;
  if (from < before.length && isLowSurrogate(before.charCodeAt(from))) from += 1;
  if (to > 0 && isHighSurrogate(after.charCodeAt(to - 1))) to -= 1;
  return { before: before.slice(from), after: after.slice(0, to) };
}

const SYSTEM_PROMPT =
  "You explain words to someone reading an answer of a coding agent. Answer with the explanation only: no preface, no quotes, no Markdown.";

/** What Claude Code is asked: the word, marked in the text around it ("…" where the text was cut). */
function promptOf(word: string, around: { before: string; after: string }, cut: { before: boolean; after: boolean }): string {
  const passage = `${cut.before ? "…" : ""}${around.before}<selected>${word}</selected>${around.after}${cut.after ? "…" : ""}`;
  return [
    `In one short sentence, explain what "${word}" means in the passage below, where it is marked with <selected>.`,
    "Write it in the language of the passage, for someone who does not know the word, and fit it to how the passage uses it.",
    "",
    "<passage>",
    passage,
    "</passage>",
  ].join("\n");
}

/**
 * Claude Code's arguments: no tools, hooks, MCP servers, skills or saved session, so it only answers. A low effort
 * thinks less, so that the meaning comes sooner.
 */
export function argsOf(prompt: string, model: string): string[] {
  return [
    "-p",
    prompt,
    "--model",
    model,
    "--effort",
    "low",
    "--output-format",
    "json",
    "--system-prompt",
    SYSTEM_PROMPT,
    "--tools",
    "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--settings",
    JSON.stringify({ disableAllHooks: true }),
  ];
}

/** What Claude Code answered (`--output-format json`: its `result`, on one line), undefined when stdout is not that. */
function resultOf(stdout: string): { text: string; isError: boolean } | undefined {
  let out: { result?: unknown; is_error?: unknown } | null;
  try {
    out = JSON.parse(stdout) as typeof out;
  } catch {
    return undefined;
  }
  if (typeof out !== "object" || out === null) return undefined;
  return { text: typeof out.result === "string" ? out.result.replace(/\s+/g, " ").trim() : "", isError: out.is_error === true };
}

const notExplained = (why: string | undefined) => new PluginError(why ? `意味を調べられませんでした（${why.slice(0, 200)}）。` : "意味を調べられませんでした。");

/** The meaning in what Claude Code answered. */
function meaningOf(stdout: string): string {
  const out = resultOf(stdout);
  if (!out) throw new PluginError("Claude Code の答えを読めませんでした。");
  if (out.isError) throw notExplained(out.text);
  if (!out.text) throw new PluginError("Claude Code が意味を答えませんでした。");
  return out.text.length > MEANING_CHARS ? `${out.text.slice(0, MEANING_CHARS)}…` : out.text;
}

/** Why Claude Code gave no answer, for the person. */
function failure(e: ExecError): PluginError {
  if (e.killed) return new PluginError("意味を、時間内に調べられませんでした。");
  if (e.code === "ENOENT" || e.code === 127) return new PluginError("Claude Code が見つかりません（gasho-daemon の GASHO_CLAUDE_BIN）。");
  // A Claude Code that fails (not logged in, a usage limit) exits with 1 and says why in its JSON on stdout, often with
  // nothing on stderr.
  const out = resultOf(e.stdout ?? "");
  return notExplained((out ? out.text || e.stderr || "" : e.stderr || e.stdout || "").trim().split("\n")[0]);
}

/** The params of `meaning`, which come from the browser. */
function paramsOf(params: unknown): MeaningParams {
  const { word, before, after } = (params ?? {}) as { word?: unknown; before?: unknown; after?: unknown };
  if (typeof word !== "string" || !isWord(word.trim())) throw new PluginError("選んだ語が正しくありません。");
  if (typeof before !== "string" || typeof after !== "string" || before.length > CONTEXT.max || after.length > CONTEXT.max) {
    throw new PluginError("語の前後の文が正しくありません。");
  }
  return { word: word.trim(), before, after };
}

/** The meaning of the word of `params` in the text around it, asked of the model of the settings. */
export async function explain(params: unknown, ctx: DaemonContext): Promise<Meaning> {
  const { word, before, after } = paramsOf(params);
  // ctx.settings changes when the setting does: read at each call.
  const around = aroundOf(before, word, after, contextCharsOf(ctx.settings.contextChars));
  const prompt = promptOf(word, around, { before: around.before.length < before.length, after: around.after.length < after.length });
  await fs.mkdir(ctx.dataDir, { recursive: true });
  const claude = process.env.GASHO_CLAUDE_BIN ?? "claude";
  let stdout: string;
  try {
    ({ stdout } = await ctx.exec(claude, argsOf(prompt, modelOf(ctx.settings.model)), { cwd: ctx.dataDir, timeoutMs: RUN_MS, maxBuffer: 1024 * 1024 }));
  } catch (e) {
    throw failure(e as ExecError);
  }
  return { meaning: meaningOf(stdout) };
}
