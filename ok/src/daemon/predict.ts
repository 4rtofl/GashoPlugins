// The prompts the person is likely to send next, predicted from the end of a session's conversation. The conversation
// is read from Claude Code's transcript (~/.claude/projects/<folder>/<session id>.jsonl), and a Claude Code started
// with -p in this plugin's own folder (ctx.dataDir, where gasho-daemon does not take it for a session, plugin API 1.4)
// is asked for the prompts, with no tools and no hooks.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PluginError, type DaemonContext, type ExecError } from "@gasho/plugin-sdk/daemon";
import type { Prediction } from "../types.ts";

/** A message of the conversation, as the prediction reads it. */
export interface Turn {
  role: "user" | "assistant";
  text: string;
}

/** The ranges of the settings count and maxChars (gasho-plugin.json). */
export const COUNT = { default: 3, min: 1, max: 9 };
export const CHARS = { default: 200, min: 1, max: 1000 };

/** How many prompts are asked for, and the length a longer one is cut to. */
export interface Limits {
  count: number;
  chars: number;
}

// The Gasho server checks the range, not the step: 2.5 can come.
const intOf = (v: unknown, r: typeof COUNT) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(r.max, Math.max(r.min, Math.round(v))) : r.default;

/** The limits of the settings count and maxChars, their defaults when they are not numbers. */
export const limitsOf = (settings: Record<string, unknown>): Limits => ({ count: intOf(settings.count, COUNT), chars: intOf(settings.maxChars, CHARS) });

/** How much of the end of the transcript is read: it can be hundreds of MB. */
export const TAIL_BYTES = 2 * 1024 * 1024;
/** The messages given to the model, the newest ones. */
export const MAX_TURNS = 8;
/** Each message is cut to this, except the last reply, which is what the person answers. */
export const TURN_CHARS = 1500;
export const LAST_REPLY_CHARS = 8000;
/** How long Claude Code may take; the method waits 100 s (gasho-plugin.json). */
export const RUN_MS = 90_000;
export const MODELS = ["haiku", "sonnet"] as const;

/** Claude Code's folder for a session's folder: every character other than a letter or a digit becomes "-". */
export const projectFolder = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

const claudeDir = () => process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");

/**
 * The transcript of a session. Claude Code shortens the folder's name of a long path, so when it is not where the
 * folder's name says, every folder of projects/ is looked in.
 */
export async function findTranscript(sessionId: string, cwd: string, base = claudeDir()): Promise<string | undefined> {
  if (!/^[0-9a-zA-Z-]{1,100}$/.test(sessionId)) return undefined;
  const projects = path.join(base, "projects");
  const direct = path.join(projects, projectFolder(cwd), `${sessionId}.jsonl`);
  if (await exists(direct)) return direct;
  let folders: string[];
  try {
    folders = await fs.readdir(projects);
  } catch {
    return undefined;
  }
  for (const f of folders) {
    const p = path.join(projects, f, `${sessionId}.jsonl`);
    if (await exists(p)) return p;
  }
  return undefined;
}

async function exists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

/** The last TAIL_BYTES of a file, without the first line when it was cut. */
export async function readTail(file: string, bytes = TAIL_BYTES): Promise<string> {
  const h = await fs.open(file, "r");
  try {
    const { size } = await h.stat();
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    await h.read(buf, 0, buf.length, start);
    const text = buf.toString("utf8");
    return start === 0 ? text : text.slice(text.indexOf("\n") + 1);
  } finally {
    await h.close();
  }
}

/** Text Claude Code puts in a user's message that the person did not write: commands, their output, notices. */
const NOT_TYPED = /^<(command-|local-command-|task-notification|bash-|user-memory-input)/;
const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is { type: "text"; text: string } => !!b && typeof b === "object" && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

/**
 * The person's messages and Claude's replies in a transcript (JSON lines), oldest first: tool calls, their results,
 * thinking, subagents' messages and what Claude Code added are left out. Claude's texts in a row are one reply.
 */
export function turnsOf(jsonl: string): Turn[] {
  const turns: Turn[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.includes('"message"')) continue;
    let m: { type?: unknown; isMeta?: unknown; isSidechain?: unknown; message?: { content?: unknown } };
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if ((m.type !== "user" && m.type !== "assistant") || m.isMeta === true || m.isSidechain === true) continue;
    const text = textOf(m.message?.content).replace(REMINDER, "").trim();
    if (!text || (m.type === "user" && NOT_TYPED.test(text))) continue;
    const last = turns.at(-1);
    if (last && last.role === m.type) last.text += `\n\n${text}`;
    else turns.push({ role: m.type, text });
  }
  return turns;
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const cutHead = (s: string, n: number) => (s.length > n ? `…${s.slice(-n)}` : s);

/** What Claude Code is asked, or undefined when the conversation does not end with a reply of Claude's. */
export function promptOf(turns: Turn[], { count, chars }: Limits): string | undefined {
  const recent = turns.slice(-MAX_TURNS);
  if (recent.at(-1)?.role !== "assistant") return undefined;
  const log = recent
    .map((t, i) => {
      const lastReply = i === recent.length - 1;
      // The end of a long reply is where it asks or sums up.
      const text = lastReply ? cutHead(t.text, LAST_REPLY_CHARS) : cut(t.text, TURN_CHARS);
      return `<${t.role === "user" ? "human" : "agent"}>\n${text}\n</${t.role === "user" ? "human" : "agent"}>`;
    })
    .join("\n");
  return [
    "Below is the end of a conversation between a human and a coding agent. The agent has just replied.",
    `Predict the ${count} message${count === 1 ? "" : "s"} the human is most likely to type next, the likeliest first.`,
    `Write each as the human would type it: at most ${chars} characters, in the language the human uses, and something the agent can act on.`,
    'When the agent asked a question or offered choices, answer it ("はい、進めて", "2 で"). Do not repeat what was already done.',
    `Answer with a JSON array of strings only, such as [${Array(count).fill('"..."').join(", ")}], with nothing else.`,
    "",
    "<conversation>",
    log,
    "</conversation>",
  ].join("\n");
}

/** The prompts in what Claude Code answered (`--output-format json`: its `result`, which should be a JSON array). */
export function promptsOf(stdout: string, { count, chars }: Limits): string[] {
  let result: unknown;
  try {
    result = (JSON.parse(stdout) as { result?: unknown }).result;
  } catch {
    return [];
  }
  if (typeof result !== "string") return [];
  // The array, even inside a ```json fence or after a sentence.
  const start = result.indexOf("[");
  const end = result.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let list: unknown;
  try {
    list = JSON.parse(result.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const prompts: string[] = [];
  for (const p of list) {
    if (typeof p !== "string") continue;
    const text = cut(p.replace(/\s+/g, " ").trim(), chars);
    if (text && !prompts.includes(text)) prompts.push(text);
    if (prompts.length === count) break;
  }
  return prompts;
}

/** Claude Code's arguments: no tools, hooks, MCP servers, skills or saved session, so it only answers. */
export function argsOf(prompt: string, model: string): string[] {
  return [
    "-p",
    prompt,
    "--model",
    model,
    "--output-format",
    "json",
    "--tools",
    "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--settings",
    JSON.stringify({ disableAllHooks: true }),
  ];
}

const modelOf = (v: unknown): string => (MODELS.includes(v as (typeof MODELS)[number]) ? (v as string) : "haiku");

/** Why Claude Code gave no answer, for the person. */
function failure(e: ExecError): PluginError {
  if (e.killed) return new PluginError("次の指示を、時間内に予測できませんでした。");
  if (e.code === "ENOENT" || e.code === 127) return new PluginError("Claude Code が見つかりません（gasho-daemon の GASHO_CLAUDE_BIN）。");
  const why = (e.stderr || e.stdout || "").trim().split("\n")[0]?.slice(0, 200);
  return new PluginError(why ? `次の指示を予測できませんでした（${why}）。` : "次の指示を予測できませんでした。");
}

/**
 * The answers already given, by session, the time of its last activity and the settings, so that browsers share one
 * run and one made before the settings changed is not given after.
 */
const known = new Map<string, Promise<Prediction>>();
const KNOWN_MAX = 100;

/** The prompts the person of ctx.session is likely to send next, after the reply that ended at `at`. */
export function predict(ctx: DaemonContext, at: number, o: { base?: string; claude?: string } = {}): Promise<Prediction> {
  const session = ctx.session;
  if (!session) throw new PluginError("セッションが見つかりません。");
  // DaemonSession.agent (plugin API 1.16) is not in the SDK this repository builds with yet.
  const agent = (session as { agent?: unknown }).agent;
  if (agent !== undefined && agent !== "claude") throw new PluginError("Claude Code のセッションでだけ予測します。");
  const model = modelOf(ctx.settings.model);
  const limits = limitsOf(ctx.settings);
  const key = `${session.sessionId}@${at}:${model}:${limits.count}:${limits.chars}`;
  const had = known.get(key);
  if (had) return had;
  const run = (async (): Promise<Prediction> => {
    const file = await findTranscript(session.sessionId, session.cwd, o.base);
    if (!file) return { prompts: [] };
    const prompt = promptOf(turnsOf(await readTail(file)), limits);
    if (!prompt) return { prompts: [] };
    await fs.mkdir(ctx.dataDir, { recursive: true });
    const claude = o.claude ?? process.env.GASHO_CLAUDE_BIN ?? "claude";
    try {
      const { stdout } = await ctx.exec(claude, argsOf(prompt, model), { cwd: ctx.dataDir, timeoutMs: RUN_MS, maxBuffer: 1024 * 1024 });
      return { prompts: promptsOf(stdout, limits) };
    } catch (e) {
      throw failure(e as ExecError);
    }
  })();
  known.set(key, run);
  // A failure is not kept: the next showing tries again.
  run.catch(() => known.delete(key));
  while (known.size > KNOWN_MAX) known.delete(known.keys().next().value as string);
  return run;
}

/** Forgets the answers (for the tests). */
export function forget(): void {
  known.clear();
}
