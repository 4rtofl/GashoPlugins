// The end of a job's log of GitHub Actions, up to the step that failed: { repo, job } → JobLog. A finished job's log
// does not change, so it is kept as long as gasho-daemon keeps anything.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh, KEEP_MAX_SECONDS } from "../core.ts";
import { actionsIdArg } from "../detail/checks.ts";
import { repoArg } from "../gh.ts";
import type { Op } from "../op.ts";

export interface LogLine {
  text: string;
  /** ##[error] and ##[warning] are GitHub's annotations; ##[group] starts a step ("Run npm test") or a part of it. */
  level?: "error" | "warning" | "group";
}

export interface JobLog {
  lines: LogLine[];
  /** Lines before these were left out. */
  cut: boolean;
}

/** Lines sent to the screen, and characters per line. */
const LINES = 100;
const LINE_MAX = 1000;

export const logArgs = (repo: string, job: number): string[] => ["api", `repos/${repo}/actions/jobs/${job}/logs`];

const STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/;
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
const COMMAND = /^##\[([a-z]+)\]/;

/**
 * The lines up to the last error, from the start of its step when that is near: what comes after the error is the
 * clean-up of the job (Post Run actions/checkout…), which says nothing of why it failed.
 */
export function parseLog(text: string, lines = LINES): JobLog {
  const all = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.replace(STAMP, "").replace(ANSI, ""));
  let end = all.length;
  while (end > 0 && all[end - 1]?.trim() === "") end--;
  for (let i = end - 1; i >= 0; i--) {
    if (all[i]?.startsWith("##[error]")) {
      end = i + 1;
      break;
    }
  }
  let start = Math.max(0, end - lines);
  for (let i = end - 1; i >= start; i--) {
    if (all[i]?.startsWith("##[group]Run ")) {
      start = i;
      break;
    }
  }
  const out = all.slice(start, end).flatMap((raw): LogLine[] => {
    const command = COMMAND.exec(raw)?.[1];
    if (command === "endgroup") return [];
    const text = (command ? raw.slice(command.length + 4) : raw).slice(0, LINE_MAX);
    const level = command === "error" || command === "warning" || command === "group" ? command : undefined;
    return [{ text, ...(level ? { level } : {}) }];
  });
  return { lines: out, cut: start > 0 };
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const job = actionsIdArg(p.job);
    return gh(
      `read the log of job ${job}`,
      async () => {
        try {
          const { stdout } = await ctx.github.read(logArgs(repo, job), { maxAgeSeconds: KEEP_MAX_SECONDS, maxBuffer: 32 * 1024 * 1024 });
          return parseLog(stdout);
        } catch (e) {
          const err = (e ?? {}) as { code?: unknown; stderr?: unknown };
          if (err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") throw new PluginError("ログが大きすぎて読めませんでした。GitHub で開いてください。");
          if (typeof err.stderr === "string" && /HTTP (404|410)/.test(err.stderr)) {
            throw new PluginError("このジョブのログは GitHub にありません。まだ書き終わっていないか、残しておく期限が過ぎました。");
          }
          throw e;
        }
      },
      ctx,
    );
  },
} satisfies Op;
