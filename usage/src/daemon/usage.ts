// The Claude.ai plan's usage limits, read through Claude Code as its /usage reads them. A Claude Code started with -p
// and stream-json input answers the Agent SDK's control request get_usage with them, without any message to the model
// (no tokens used). It runs in this plugin's own folder (ctx.dataDir), where gasho-daemon does not take it for a
// session (plugin API 1.4). get_usage is experimental (the SDK calls it usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_
// THIS_API_YET): only the fields read here are relied on, and an answer without them is "could not read", so that the
// web part falls back to what the status line reported.
import fs from "node:fs/promises";
import { PluginError, type DaemonContext, type ExecError } from "@gasho/plugin-sdk/daemon";
import type { ModelWindow, UsageLimits, UsageWindow } from "../types.ts";

/** The two requests, a line each: the SDK's handshake, then get_usage without the scan of local transcripts. */
export const REQUESTS = {
  INIT: JSON.stringify({ type: "control_request", request_id: "init", request: { subtype: "initialize" } }),
  USAGE: JSON.stringify({ type: "control_request", request_id: "usage", request: { subtype: "get_usage", skip_behaviors: true } }),
};

/**
 * ctx.exec gives a command no stdin, so a shell pipes the requests in; their text and Claude Code's path come from the
 * environment, never from the browser. Claude Code answers both and ends when its stdin does.
 */
export const SCRIPT =
  'printf \'%s\\n%s\\n\' "$INIT" "$USAGE" | "$CLAUDE" -p --input-format stream-json --output-format stream-json --verbose --no-session-persistence';

/** A result is used again for this long: get_usage starts a Claude Code, and the limits change slowly. */
export const KEEP_MS = 30_000;
const RUN_MS = 20_000;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function windowOf(v: unknown): UsageWindow | undefined {
  if (!v || typeof v !== "object") return undefined;
  const w = v as Record<string, unknown>;
  const percent = num(w.utilization);
  const resetsAt = typeof w.resets_at === "string" ? Date.parse(w.resets_at) : Number.NaN;
  return percent !== undefined && Number.isFinite(resetsAt) ? { percent, resetsAt } : undefined;
}

/** The limits in what Claude Code printed (stream-json: a message per line), or a PluginError saying why there are none. */
export function limitsOf(stdout: string, now: number): UsageLimits {
  for (const line of stdout.split("\n")) {
    if (!line.includes('"usage"')) continue;
    let m: { type?: unknown; response?: { subtype?: unknown; request_id?: unknown; error?: unknown; response?: unknown } };
    try {
      m = JSON.parse(line) as typeof m;
    } catch {
      continue;
    }
    if (m.type !== "control_response" || m.response?.request_id !== "usage") continue;
    if (m.response.subtype !== "success") {
      const why = typeof m.response.error === "string" ? m.response.error.slice(0, 200) : "Claude Code がエラーを返しました";
      throw new PluginError(`週の上限を読めませんでした（${why}）。`);
    }
    const r = (m.response.response ?? {}) as { rate_limits_available?: unknown; rate_limits?: Record<string, unknown> | null };
    if (r.rate_limits_available === false) return { at: now, available: false, models: [] };
    const rl = r.rate_limits;
    if (!rl || typeof rl !== "object") throw new PluginError("週の上限を読めませんでした（Claude.ai から使用量を読めませんでした）。");
    const fiveHour = windowOf(rl.five_hour);
    const sevenDay = windowOf(rl.seven_day);
    const models: ModelWindow[] = [];
    for (const s of Array.isArray(rl.model_scoped) ? rl.model_scoped : []) {
      const name = s && typeof s === "object" ? (s as Record<string, unknown>).display_name : undefined;
      const w = windowOf(s);
      if (typeof name === "string" && name.trim() && w) models.push({ name: name.trim().slice(0, 40), ...w });
    }
    if (!fiveHour && !sevenDay && models.length === 0) throw new PluginError("週の上限を読めませんでした（答えに上限がありませんでした）。");
    return { at: now, available: true, ...(fiveHour ? { fiveHour } : {}), ...(sevenDay ? { sevenDay } : {}), models };
  }
  throw new PluginError("週の上限を読めませんでした（Claude Code が get_usage に答えませんでした）。");
}

/** Why running Claude Code failed, for the person. */
function failure(e: unknown): PluginError {
  if (e instanceof PluginError) return e;
  const x = e as Partial<ExecError>;
  if (x.killed) return new PluginError("週の上限を、時間内に読めませんでした。");
  if (x.code === 127 || x.code === "ENOENT") return new PluginError("Claude Code が見つかりません（gasho-daemon の GASHO_CLAUDE_BIN）。");
  const why = (x.stderr ?? "").trim().split("\n")[0]?.slice(0, 200);
  return new PluginError(`週の上限を読めませんでした${why ? `（${why}）` : ""}。`);
}

type Exec = DaemonContext["exec"];

let last: UsageLimits | undefined;
let running: Promise<UsageLimits> | undefined;

/**
 * The limits, read at most once every KEEP_MS on this working server: calls that come while Claude Code is being asked
 * get the same answer, so that several browsers do not start several Claude Codes.
 */
export function readLimits(o: { exec: Exec; dataDir: string; claude?: string; now?: () => number }): Promise<UsageLimits> {
  const now = o.now ?? Date.now;
  if (last && now() - last.at < KEEP_MS) return Promise.resolve(last);
  running ??= (async () => {
    try {
      await fs.mkdir(o.dataDir, { recursive: true });
      const { stdout } = await o.exec("sh", ["-c", SCRIPT], {
        cwd: o.dataDir,
        timeoutMs: RUN_MS,
        env: { ...REQUESTS, CLAUDE: o.claude ?? process.env.GASHO_CLAUDE_BIN ?? "claude" },
      });
      last = limitsOf(stdout, now());
      return last;
    } catch (e) {
      throw failure(e);
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
