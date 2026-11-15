// GitHub Actions of a repository: its runs (filtered by workflow and branch) and one run with its jobs, steps and, for
// a failed job, the end of its log. `gh run list`, `gh workflow list` and `gh run view` give JSON; a job's log comes
// from the REST API (`gh api repos/<repo>/actions/jobs/<id>/logs`) as text.
import type { Job, Run, RunDetail, Runs, RunState, Step, Workflow } from "../types.ts";
import { arr, githubUrl, num, parseJson, rec, str, type Gh } from "./gh.ts";

/** Runs sent per list. */
export const RUNS_LIMIT = 50;
/** Failed jobs whose log is read per run, and lines of it sent. */
const LOGS_MAX = 3;
export const LOG_LINES = 80;
const LOG_LINE_MAX = 500;

const RUN_FIELDS = "attempt,conclusion,createdAt,databaseId,displayTitle,event,headBranch,number,startedAt,status,updatedAt,url,workflowDatabaseId,workflowName";

/** A run's, job's or step's status and conclusion, in a few words. */
export function runState(status: unknown, conclusion: unknown): RunState {
  const s = typeof status === "string" ? status.toLowerCase() : "";
  if (s === "in_progress") return "in_progress";
  if (s === "waiting" || s === "action_required") return "waiting";
  if (s && s !== "completed") return "queued";
  switch (typeof conclusion === "string" ? conclusion.toLowerCase() : "") {
    case "success":
      return "success";
    case "cancelled":
      return "cancelled";
    case "skipped":
      return "skipped";
    case "neutral":
    case "stale":
      return "neutral";
    case "action_required":
      return "waiting";
    case "":
      return s === "completed" ? "neutral" : "queued";
    default:
      // failure, timed_out, startup_failure
      return "failure";
  }
}


function parseRun(raw: unknown): Run | undefined {
  const r = rec(raw);
  const id = num(r.databaseId);
  const url = githubUrl(r.url);
  if (!id || !url) return undefined;
  return {
    id,
    ...(num(r.number) ? { number: num(r.number) } : {}),
    workflow: str(r.workflowName) ?? "",
    ...(num(r.workflowDatabaseId) ? { workflowId: num(r.workflowDatabaseId) } : {}),
    title: str(r.displayTitle) ?? "",
    ...(str(r.headBranch) ? { branch: str(r.headBranch) } : {}),
    event: str(r.event) ?? "",
    state: runState(r.status, r.conclusion),
    ...(num(r.attempt) ? { attempt: num(r.attempt) } : {}),
    createdAt: str(r.createdAt) ?? "",
    ...(str(r.startedAt) ? { startedAt: str(r.startedAt) } : {}),
    ...(str(r.updatedAt) ? { updatedAt: str(r.updatedAt) } : {}),
    url,
  };
}

/** `gh run list --json …` output; anything malformed is left out. */
export function parseRuns(json: string): Run[] {
  return arr(parseJson(json)).flatMap((r) => {
    const run = parseRun(r);
    return run ? [run] : [];
  });
}

/** `gh workflow list --json id,name,path,state` output. */
export function parseWorkflows(json: string): Workflow[] {
  return arr(parseJson(json)).flatMap((raw) => {
    const w = rec(raw);
    const id = num(w.id);
    const name = str(w.name);
    if (!id || !name) return [];
    return [{ id, name, path: str(w.path) ?? "", active: w.state === "active" }];
  });
}

/** `gh run view --json …,jobs` output; undefined when it is not a run. */
export function parseRunDetail(json: string): RunDetail | undefined {
  const raw = parseJson(json);
  const run = parseRun(raw);
  if (!run) return undefined;
  const jobs = arr(rec(raw).jobs).flatMap((rawJob): Job[] => {
    const j = rec(rawJob);
    const id = num(j.databaseId);
    if (!id) return [];
    const steps = arr(j.steps).flatMap((rawStep): Step[] => {
      const s = rec(rawStep);
      const number = num(s.number);
      const name = str(s.name);
      if (number === undefined || !name) return [];
      return [
        {
          number,
          name,
          state: runState(s.status, s.conclusion),
          ...(str(s.startedAt) ? { startedAt: str(s.startedAt) } : {}),
          ...(str(s.completedAt) ? { completedAt: str(s.completedAt) } : {}),
        },
      ];
    });
    return [
      {
        id,
        name: str(j.name) ?? "",
        state: runState(j.status, j.conclusion),
        ...(str(j.startedAt) ? { startedAt: str(j.startedAt) } : {}),
        ...(str(j.completedAt) ? { completedAt: str(j.completedAt) } : {}),
        ...(githubUrl(j.url) ? { url: githubUrl(j.url) } : {}),
        steps: steps.sort((a, b) => a.number - b.number),
      },
    ];
  });
  return { ...run, jobs };
}

// ---- a job's log ----

const STAMP = /^\uFEFF?(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d+)?Z ?/;
// Colors and other escape sequences, and control characters but the tab.
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]|[\x00-\x08\x0b-\x1f\x7f]/g;

interface LogLine {
  /** ms since the epoch, to the second; NaN without a timestamp. */
  at: number;
  text: string;
}

function logLines(log: string): LogLine[] {
  return log.split(/\r?\n/).map((line) => {
    const m = STAMP.exec(line);
    return { at: m ? Date.parse(`${m[1]}Z`) : Number.NaN, text: (m ? line.slice(m[0].length) : line).replace(ESCAPES, "") };
  });
}

/**
 * The end of a failed job's log: the part of the step that failed (its lines, by the step's start and end, from its
 * "##[group]Run …" to the cleanup after it), else of the whole log. Timestamps, colors and GitHub's group markers go.
 */
export function logTail(log: string, failed?: Pick<Step, "startedAt" | "completedAt">, max = LOG_LINES): string[] {
  let lines = logLines(log);
  const start = Date.parse(failed?.startedAt ?? "");
  const end = Date.parse(failed?.completedAt ?? "");
  if (Number.isFinite(start) && Number.isFinite(end)) {
    // The step's times are to the second: its lines are those of [start, end + 1 s).
    const inside = lines.filter((l) => l.at >= start && l.at < end + 1000);
    const first = inside.findIndex((l) => l.text.startsWith("##[group]Run "));
    let part = first >= 0 ? inside.slice(first) : inside;
    const after = part.findIndex((l, i) => i > 0 && (l.text.startsWith("##[group]Run ") || l.text === "Post job cleanup."));
    if (after > 0) part = part.slice(0, after);
    if (part.some((l) => l.text.trim())) lines = part;
  }
  const shown = lines
    .filter((l) => l.text !== "##[endgroup]")
    .map((l) => l.text.replace(/^##\[group\]/, "").replace(/^##\[(error|warning|notice)\]/, (_, k: string) => `${k[0]?.toUpperCase()}${k.slice(1)}: `))
    .map((t) => (t.length > LOG_LINE_MAX ? `${t.slice(0, LOG_LINE_MAX)}…` : t));
  while (shown.length && !shown[shown.length - 1]?.trim()) shown.pop();
  return shown.slice(-max);
}

// ---- reading ----

/** The runs of `repo`, newest first, of one workflow and branch if given, and its workflows. */
export async function listRuns(ctx: Gh, repo: string, o: { workflow?: number; branch?: string; maxAgeSeconds: number }): Promise<Omit<Runs, "repo">> {
  const args = ["run", "list", "--repo", repo, "--limit", String(RUNS_LIMIT + 1), "--json", RUN_FIELDS];
  if (o.workflow) args.push("--workflow", String(o.workflow));
  if (o.branch) args.push("--branch", o.branch);
  const [runs, workflows] = await Promise.all([
    ctx.github.read(args, { maxAgeSeconds: o.maxAgeSeconds, timeoutMs: 25_000 }),
    // Workflows change rarely.
    ctx.github.read(["workflow", "list", "--repo", repo, "--all", "--limit", "200", "--json", "id,name,path,state"], {
      maxAgeSeconds: Math.max(o.maxAgeSeconds, 300),
      timeoutMs: 25_000,
    }),
  ]);
  const list = parseRuns(runs.stdout);
  return { workflows: parseWorkflows(workflows.stdout), runs: list.slice(0, RUNS_LIMIT), truncated: list.length > RUNS_LIMIT };
}

/** The text of a job's log. `--allow-escape-sequences`: gh 2.8x and later refuse to print the colors of a log without it. */
async function jobLog(ctx: Gh, repo: string, job: number): Promise<string> {
  const path = `repos/${repo}/actions/jobs/${job}/logs`;
  const o = { maxAgeSeconds: 600, timeoutMs: 45_000, maxBuffer: 32 * 1024 * 1024 };
  try {
    return (await ctx.github.read(["api", "--allow-escape-sequences", path], o)).stdout;
  } catch (e) {
    // An older gh has no such flag (and prints the log as it is).
    if (!/unknown flag/i.test(String((e as { stderr?: unknown }).stderr ?? ""))) throw e;
    return (await ctx.github.read(["api", path], o)).stdout;
  }
}

/** One run of `repo` with its jobs and steps; failed jobs that have finished get the end of their log. */
export async function viewRun(ctx: Gh, repo: string, id: number, o: { maxAgeSeconds: number }): Promise<RunDetail> {
  const { stdout } = await ctx.github.read(["run", "view", String(id), "--repo", repo, "--json", `${RUN_FIELDS},jobs`], {
    maxAgeSeconds: o.maxAgeSeconds,
    timeoutMs: 25_000,
  });
  const run = parseRunDetail(stdout);
  if (!run) throw new Error(`gh returned no run ${id}`);
  const failed = run.jobs.filter((j) => j.state === "failure" && j.completedAt).slice(0, LOGS_MAX);
  await Promise.all(
    failed.map(async (job) => {
      try {
        job.log = logTail(await jobLog(ctx, repo, job.id), job.steps.find((s) => s.state === "failure"));
      } catch (e) {
        const text = String((e as { stderr?: unknown }).stderr ?? (e as Error).message ?? "");
        job.logError = /HTTP 410|HTTP 404|gone/i.test(text) ? "ログはもう GitHub にありません。" : "ログを読めませんでした。GitHub で見られます。";
      }
    }),
  );
  return run;
}
