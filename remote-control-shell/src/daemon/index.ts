// The daemon part of Remote Control Shell: runs commands in the folder of the session a call is about, and answers the
// panel (README.md「メソッド」). The folder always comes from gasho-daemon (ctx.session), never from the browser; what
// the browser sends is checked here.
import { defineDaemonPlugin, PluginError, type DaemonContext } from "@gasho/plugin-sdk/daemon";
import { JOB_ID, MAX_COMMAND_CHARS, MAX_WAIT_MS, RUN_REQUEST } from "../types.ts";
import { OUTPUT_BUDGET, settingsFrom, Shells } from "./jobs.ts";

let shells: Shells | undefined;

function current(): Shells {
  if (!shells) throw new PluginError("Remote Control Shell の daemon の部分が、まだ動き始めていません。");
  return shells;
}

function sessionFolder(ctx: DaemonContext): string {
  if (!ctx.session) throw new PluginError("このセッションは見つかりません。");
  return ctx.session.cwd;
}

const fields = (params: unknown): Record<string, unknown> =>
  typeof params === "object" && params !== null && !Array.isArray(params) ? (params as Record<string, unknown>) : {};

function jobId(v: unknown): string {
  if (typeof v !== "string" || !JOB_ID.test(v)) throw new PluginError("記録の指定が正しくありません。");
  return v;
}

const intIn = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isInteger(v) ? Math.min(max, Math.max(min, v)) : fallback;

export default defineDaemonPlugin({
  start(ctx) {
    shells = new Shells({ dataDir: ctx.dataDir, log: ctx.log });
    shells.tidy();
  },
  async stop() {
    const s = shells;
    shells = undefined;
    await s?.stop();
  },
  methods: {
    /**
     * Runs { command } (or the command of the record { again }) in the working folder: the record, running. With
     * { request }, the record already started for it, if there is one.
     */
    async run(params, ctx) {
      const p = fields(params);
      const again = p.again === undefined ? undefined : jobId(p.again);
      let command: string | undefined;
      if (again === undefined) {
        if (typeof p.command !== "string" || !p.command.trim()) throw new PluginError("コマンドを入れてください。");
        if (p.command.length > MAX_COMMAND_CHARS) throw new PluginError(`コマンドが長すぎます（${MAX_COMMAND_CHARS.toLocaleString("ja-JP")}文字まで）。`);
        if (p.command.includes("\0")) throw new PluginError("コマンドに使えない文字（NUL）があります。");
        command = p.command;
      }
      const cols = typeof p.cols === "number" && Number.isInteger(p.cols) ? Math.min(500, Math.max(20, p.cols)) : undefined;
      if (p.request !== undefined && (typeof p.request !== "string" || !RUN_REQUEST.test(p.request))) throw new PluginError("依頼の指定が正しくありません。");
      const request = p.request as string | undefined;
      return current().run(
        sessionFolder(ctx),
        { command, again, ...(cols !== undefined ? { cols } : {}), ...(request !== undefined ? { request } : {}) },
        settingsFrom(ctx.settings),
      );
    },
    /** Sends { signal: "INT" | "KILL" } to the running command { job }. */
    async signal(params, ctx) {
      const p = fields(params);
      if (p.signal !== "INT" && p.signal !== "KILL") throw new PluginError("合図の指定が正しくありません。");
      return current().signal(sessionFolder(ctx), jobId(p.job), p.signal);
    },
    /** Moves the working folder to the session's folder, or to the repository { repo } gasho-daemon found in it. */
    async chdir(params, ctx) {
      const p = fields(params);
      if (!ctx.session) throw new PluginError("このセッションは見つかりません。");
      if (p.repo !== undefined && (typeof p.repo !== "string" || p.repo.length > 500)) throw new PluginError("リポジトリの指定が正しくありません。");
      return current().chdir(ctx.session.cwd, ctx.session.repo(p.repo as string | undefined).dir);
    },
    /** Removes the record { job }, or every record of a command that has ended. */
    async clear(params, ctx) {
      const p = fields(params);
      return current().clear(sessionFolder(ctx), p.job === undefined ? undefined : jobId(p.job));
    },
    /** The records and new output once something changed since { since, offsets }, waiting up to { waitMs }. */
    async watch(params, ctx) {
      const p = fields(params);
      const offsets: Record<string, number> = {};
      if (typeof p.offsets === "object" && p.offsets !== null && !Array.isArray(p.offsets)) {
        for (const [id, at] of Object.entries(p.offsets as Record<string, unknown>).slice(0, 500)) {
          if (JOB_ID.test(id) && typeof at === "number" && Number.isInteger(at) && at >= 0) offsets[id] = at;
        }
      }
      return current().watch(
        sessionFolder(ctx),
        {
          ...(typeof p.since === "string" && p.since.length <= 64 ? { since: p.since } : {}),
          offsets,
          waitMs: intIn(p.waitMs, 0, MAX_WAIT_MS, 0),
        },
        ctx.signal,
      );
    },
    /** A stretch of the output of { job }: { from, limit }. */
    async output(params, ctx) {
      const p = fields(params);
      return current().output(sessionFolder(ctx), jobId(p.job), intIn(p.from, 0, Number.MAX_SAFE_INTEGER, 0), intIn(p.limit, 1, OUTPUT_BUDGET, OUTPUT_BUDGET));
    },
    /** How many commands run in the session's folder (the header's badge). */
    async status(_params, ctx) {
      return current().status(sessionFolder(ctx));
    },
  },
});
