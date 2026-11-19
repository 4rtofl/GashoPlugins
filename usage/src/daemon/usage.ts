// The Claude.ai plan's usage limits, read through Claude Code as its /usage reads them. A Claude Code started with -p
// and stream-json input answers the Agent SDK's control request get_usage with them, without any message to the model
// (no tokens used). It runs in this plugin's own folder (ctx.dataDir), where gasho-daemon does not take it for a
// session (plugin API 1.4). get_usage is experimental (the SDK calls it usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_
// THIS_API_YET): only the fields read here are relied on, and an answer without them is "could not read", so that the
// web part falls back to what the status line reported.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { PluginError } from "@gasho/plugin-sdk/daemon";
import type { LimitWindow, ModelWindow, UsageLimits } from "../types.ts";

/** The two requests, a line each: the SDK's handshake, then get_usage without the scan of local transcripts. */
export const REQUESTS = {
  INIT: JSON.stringify({ type: "control_request", request_id: "init", request: { subtype: "initialize" } }),
  USAGE: JSON.stringify({ type: "control_request", request_id: "usage", request: { subtype: "get_usage", skip_behaviors: true } }),
};

/**
 * Claude Code's arguments. Its hooks are off: else the SessionStart and SessionEnd hooks of the person's settings and
 * plugins would run at every read, with what they do and the time they take.
 */
export const ARGS = [
  "-p",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
  "--no-session-persistence",
  "--settings",
  JSON.stringify({ disableAllHooks: true }),
];

/** A result is used again for this long: get_usage starts a Claude Code, and the limits change slowly. */
export const KEEP_MS = 30_000;

/**
 * How long Claude Code may take to answer: a few seconds on a Mac at rest, up to a minute on one under heavy load (a
 * load average of 200 to 340). The method waits 100 s (gasho-plugin.json); the web part shows what it has meanwhile.
 */
export const RUN_MS = 90_000;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function windowOf(v: unknown): LimitWindow | undefined {
  if (!v || typeof v !== "object") return undefined;
  const w = v as Record<string, unknown>;
  const percent = num(w.utilization);
  if (percent === undefined) return undefined;
  const resetsAt = typeof w.resets_at === "string" ? Date.parse(w.resets_at) : Number.NaN;
  return Number.isFinite(resetsAt) ? { percent, resetsAt } : { percent };
}

type Response = { subtype?: unknown; request_id?: unknown; error?: unknown; response?: unknown };

/** The answer to get_usage, if this line of what Claude Code printed (stream-json: a message per line) is it. */
function answerOf(line: string): Response | undefined {
  if (!line.includes('"usage"')) return undefined;
  try {
    const m = JSON.parse(line) as { type?: unknown; response?: Response };
    return m.type === "control_response" && m.response?.request_id === "usage" ? m.response : undefined;
  } catch {
    return undefined;
  }
}

/** /usage shows the Sonnet week on these plans only, and when the plan is not known (null). */
const SONNET_PLANS: unknown[] = ["max", "team", null, undefined];

/** The limits in what Claude Code printed, or a PluginError saying why there are none. */
export function limitsOf(stdout: string, now: number): UsageLimits {
  for (const line of stdout.split("\n")) {
    const res = answerOf(line);
    if (!res) continue;
    if (res.subtype !== "success") {
      const why = typeof res.error === "string" ? res.error.slice(0, 200) : "Claude Code がエラーを返しました";
      throw new PluginError(`週の上限を読めませんでした（${why}）。`);
    }
    const r = (res.response ?? {}) as { subscription_type?: unknown; rate_limits_available?: unknown; rate_limits?: Record<string, unknown> | null };
    if (r.rate_limits_available === false) return { at: now, available: false, models: [] };
    const rl = r.rate_limits;
    if (!rl || typeof rl !== "object") throw new PluginError("週の上限を読めませんでした（Claude.ai から使用量を読めませんでした）。");
    const fiveHour = windowOf(rl.five_hour);
    const sevenDay = windowOf(rl.seven_day);
    const sevenDaySonnet = SONNET_PLANS.includes(r.subscription_type) ? windowOf(rl.seven_day_sonnet) : undefined;
    const models: ModelWindow[] = [];
    for (const s of Array.isArray(rl.model_scoped) ? rl.model_scoped : []) {
      const name = s && typeof s === "object" ? (s as Record<string, unknown>).display_name : undefined;
      const w = windowOf(s);
      if (typeof name === "string" && name.trim() && w) models.push({ name: name.trim().slice(0, 40), ...w });
    }
    if (!fiveHour && !sevenDay && !sevenDaySonnet && models.length === 0) throw new PluginError("週の上限を読めませんでした（答えに上限がありませんでした）。");
    return {
      at: now,
      available: true,
      ...(fiveHour ? { fiveHour } : {}),
      ...(sevenDay ? { sevenDay } : {}),
      ...(sevenDaySonnet ? { sevenDaySonnet } : {}),
      models,
    };
  }
  throw new PluginError("週の上限を読めませんでした（Claude Code が get_usage に答えませんでした）。");
}

/** What a run of Claude Code gave. */
export interface Asked {
  /** Its answer to get_usage (a line of its output), once it printed one. */
  answer?: string;
  stderr: string;
  /** It had not answered within the time. */
  killed?: boolean;
  /** Its exit code once it ended without answering, or the code of the error that kept it from starting ("ENOENT"). */
  code?: number | string | null;
}

/** Runs Claude Code with the two requests on its stdin; `signal` stops it. */
export type Ask = (claude: string, cwd: string, timeoutMs: number, signal?: AbortSignal) => Promise<Asked>;

/** After SIGTERM, Claude Code gets this long before SIGKILL, as the commands of ctx.exec do. */
export const KILL_MS = 5000;

/**
 * Gives Claude Code's answer as soon as it prints it: it takes seconds more to end. It ends by itself once it has
 * answered (its stdin is closed). Its process group gets SIGTERM, then SIGKILL, if it still runs `timeoutMs` after its
 * start or when `signal` aborts (the call took too long, or the plugin's process is being stopped).
 */
export const askClaude: Ask = (claude, cwd, timeoutMs, signal) =>
  new Promise((resolve) => {
    let stderr = "";
    let rest = "";
    let settled = false;
    const done = (r: Omit<Asked, "stderr">) => {
      if (settled) return;
      settled = true;
      resolve({ ...r, stderr });
    };
    // A group of its own, so that what it starts is stopped with it.
    const child = spawn(claude, ARGS, { cwd, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    const group = (s: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, s);
      } catch {
        // it has ended
      }
    };
    let kill: NodeJS.Timeout | undefined;
    const stop = () => {
      if (kill) return;
      group("SIGTERM");
      kill = setTimeout(() => group("SIGKILL"), KILL_MS);
      kill.unref();
      done({ killed: true });
    };
    const timer = setTimeout(stop, timeoutMs);
    const ended = () => {
      clearTimeout(timer);
      if (kill) clearTimeout(kill);
      signal?.removeEventListener("abort", stop);
    };
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (settled) return;
      const lines = (rest + chunk).split("\n");
      rest = lines.pop() ?? "";
      const answer = lines.find((l) => answerOf(l));
      if (answer !== undefined) done({ answer });
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 64 * 1024) stderr += chunk;
    });
    child.on("error", (e: NodeJS.ErrnoException) => {
      ended();
      done({ code: e.code ?? null });
    });
    child.on("close", (code) => {
      ended();
      done(answerOf(rest) ? { answer: rest } : { code });
    });
    // It may end before it has read all of its stdin.
    child.stdin.on("error", () => undefined);
    child.stdin.end(`${REQUESTS.INIT}\n${REQUESTS.USAGE}\n`);
  });

/** Why Claude Code gave no answer, for the person. */
function failure(a: Asked): PluginError {
  if (a.killed) return new PluginError("週の上限を、時間内に読めませんでした。");
  if (a.code === 127 || a.code === "ENOENT") return new PluginError("Claude Code が見つかりません（gasho-daemon の GASHO_CLAUDE_BIN）。");
  // The code of the error that kept it from starting, such as EACCES for a file that may not be run.
  if (typeof a.code === "string") return new PluginError(`Claude Code を起動できませんでした（gasho-daemon の GASHO_CLAUDE_BIN、${a.code}）。`);
  const why = a.stderr.trim().split("\n")[0]?.slice(0, 200);
  return new PluginError(why ? `週の上限を読めませんでした（${why}）。` : "週の上限を読めませんでした（Claude Code が get_usage に答えませんでした）。");
}

let last: UsageLimits | undefined;
let running: Promise<UsageLimits> | undefined;

/**
 * The limits, read at most once every KEEP_MS on this working server: calls that come while Claude Code is being asked
 * get the same answer, so that several browsers do not start several Claude Codes.
 */
export function readLimits(o: { dataDir: string; signal?: AbortSignal; ask?: Ask; claude?: string; now?: () => number }): Promise<UsageLimits> {
  const now = o.now ?? Date.now;
  if (last && now() - last.at < KEEP_MS) return Promise.resolve(last);
  running ??= (async () => {
    try {
      await fs.mkdir(o.dataDir, { recursive: true });
      const asked = await (o.ask ?? askClaude)(o.claude ?? process.env.GASHO_CLAUDE_BIN ?? "claude", o.dataDir, RUN_MS, o.signal);
      if (asked.answer === undefined) throw failure(asked);
      last = limitsOf(asked.answer, now());
      return last;
    } finally {
      running = undefined;
    }
  })();
  return running;
}

/** Forgets what was read (for the tests). */
export function forget(): void {
  last = undefined;
  running = undefined;
}
