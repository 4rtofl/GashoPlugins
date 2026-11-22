// GitHub Actions of a repository: its runs (filtered by workflow and branch) and one run with its jobs, steps and, for
// a failed job, the end of its log. `gh run list`, `gh workflow list` and `gh run view` give JSON; a job's log comes
// from the REST API (`gh api repos/<repo>/actions/jobs/<id>/logs`) as text. A run run again is read at its latest
// attempt, or at an earlier one (`gh run view --attempt`).
import type { Job, Run, RunDetail, Runs, RunState, Step, Workflow } from "../types.ts";
import { arr, cut, githubUrl, num, parseJson, rec, str, type Gh } from "./gh.ts";

/** Runs sent per list. */
export const RUNS_LIMIT = 50;
/** Failed jobs whose log is read per run, and lines of it sent. */
export const LOGS_MAX = 3;
export const LOG_LINES = 80;
const LOG_LINE_MAX = 500;

const RUN_FIELDS = "attempt,conclusion,createdAt,databaseId,displayTitle,event,headBranch,name,number,startedAt,status,updatedAt,url,workflowDatabaseId,workflowName";

/** A run's, job's or step's status and conclusion, in a few words. */
export function runState(status: unknown, conclusion: unknown): RunState {
  const s = typeof status === "string" ? status.toLowerCase() : "";
  if (s === "in_progress") return "in_progress";
  if (s === "waiting") return "waiting";
  if (s === "action_required") return "action_required";
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
      return "action_required";
    case "":
      return s === "completed" ? "neutral" : "queued";
    default:
      // failure, timed_out, startup_failure
      return "failure";
  }
}

/** A time of gh's output; gh gives year 1 for one that has not come yet (a step not started, a job not finished). */
export const time = (v: unknown): string | undefined => {
  const s = str(v);
  return s && !s.startsWith("0001-") ? s : undefined;
};

function parseRun(raw: unknown): Run | undefined {
  const r = rec(raw);
  const id = num(r.databaseId);
  const url = githubUrl(r.url);
  if (!id || !url) return undefined;
  return {
    id,
    ...(num(r.number) ? { number: num(r.number) } : {}),
    workflow: str(r.workflowName) ?? str(r.name) ?? "",
    ...(num(r.workflowDatabaseId) ? { workflowId: num(r.workflowDatabaseId) } : {}),
    title: str(r.displayTitle) ?? "",
    ...(str(r.headBranch) ? { branch: str(r.headBranch) } : {}),
    event: str(r.event) ?? "",
    state: runState(r.status, r.conclusion),
    ...(r.conclusion === "startup_failure" ? { startupFailure: true } : {}),
    ...(num(r.attempt) ? { attempt: num(r.attempt) } : {}),
    createdAt: time(r.createdAt) ?? "",
    ...(time(r.startedAt) ? { startedAt: time(r.startedAt) } : {}),
    ...(time(r.updatedAt) ? { updatedAt: time(r.updatedAt) } : {}),
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
          ...(time(s.startedAt) ? { startedAt: time(s.startedAt) } : {}),
          ...(time(s.completedAt) ? { completedAt: time(s.completedAt) } : {}),
        },
      ];
    });
    return [
      {
        id,
        name: str(j.name) ?? "",
        state: runState(j.status, j.conclusion),
        ...(time(j.startedAt) ? { startedAt: time(j.startedAt) } : {}),
        ...(time(j.completedAt) ? { completedAt: time(j.completedAt) } : {}),
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

const stepStart = (text: string): boolean => text.startsWith("##[group]Run ") || text.startsWith("##[start-action ") || text === "Post job cleanup.";
const isError = (l: LogLine): boolean => l.text.startsWith("##[error]");

/**
 * Where the job's own steps start among `lines`: "##[group]Run …" and "Post job cleanup.", but those of the steps of
 * a composite action, which newer runners put between "##[start-action …]" and "##[end-action …]".
 */
function jobStepStarts(lines: LogLine[]): number[] {
  const starts: number[] = [];
  let depth = 0;
  lines.forEach((l, i) => {
    if (l.text.startsWith("##[start-action ")) depth++;
    else if (l.text.startsWith("##[end-action ")) depth = Math.max(0, depth - 1);
    else if (depth === 0 && (l.text.startsWith("##[group]Run ") || l.text === "Post job cleanup.")) starts.push(i);
  });
  return starts;
}

/**
 * The end of a failed job's log: the part of the first step that failed (its lines, by the step's start and end, from
 * its "##[group]Run …" to the next step or the cleanup after its last error), else of the whole log. Timestamps,
 * colors and GitHub's markers go.
 */
export function logTail(log: string, failed?: Pick<Step, "startedAt" | "completedAt">, max = LOG_LINES): string[] {
  let lines = logLines(log);
  const start = Date.parse(failed?.startedAt ?? "");
  const end = Date.parse(failed?.completedAt ?? "");
  if (Number.isFinite(start) && Number.isFinite(end)) {
    // The step's times are to the second: its lines are those of [start, end + 1 s). Steps that ran in its first second
    // before it, and in its last second after it (one of `if: failure()` that fails too), are inside as well. Those
    // before it succeeded, so its error is the first, and it is the last of the job's steps to start before that.
    // Its script may print "::group::Run …" too, so only starts in those seconds are taken for those of other steps.
    const inside = lines.filter((l) => l.at >= start && l.at < end + 1000);
    const starts = jobStepStarts(inside);
    const opening = starts.filter((i) => inside[i]!.at < start + 1000);
    const errorAt = inside.findIndex(isError);
    const first = errorAt >= 0 ? (opening.findLast((i) => i < errorAt) ?? -1) : (opening[0] ?? -1);
    const next = starts.find((i) => i > Math.max(errorAt, first) && inside[i]!.at >= end);
    let part = inside.slice(Math.max(first, 0), next);
    // The steps of a composite action start with "##[group]Run " too, and run until the one that fails: the step ends
    // at the first start after its last error (else after its own start).
    const lastError = part.findLastIndex(isError);
    const after = part.findIndex((l, i) => i > Math.max(lastError, 0) && stepStart(l.text));
    if (after > 0) part = part.slice(0, after);
    if (part.some((l) => l.text.trim())) lines = part;
  }
  const shown = lines
    // Markers of where the steps of a composite action start and end.
    .filter((l) => l.text !== "##[endgroup]" && !/^##\[(start|end)-action /.test(l.text))
    .map((l) => l.text.replace(/^##\[group\]/, "").replace(/^##\[(error|warning|notice)\]/, (_, k: string) => `${k[0]?.toUpperCase()}${k.slice(1)}: `))
    .map((t) => cut(t, LOG_LINE_MAX, "…"));
  while (shown.length && !shown[shown.length - 1]?.trim()) shown.pop();
  return shown.slice(-max);
}

// ---- reading ----

/** The branches of `runs`, each once, in their order. */
const branchesOf = (runs: Run[]): string[] => [...new Set(runs.flatMap((r) => (r.branch ? [r.branch] : [])))];

/**
 * The runs of `repo`, newest first, of one workflow and branch if given, its workflows, and the branches to choose from:
 * those of the runs read without the branch (the same read as without one, so gasho-daemon answers it when it kept it).
 */
export async function listRuns(ctx: Gh, repo: string, o: { workflow?: number; branch?: string; maxAgeSeconds: number }): Promise<Omit<Runs, "repo">> {
  const all = ["run", "list", "--repo", repo, "--limit", String(RUNS_LIMIT + 1), "--json", RUN_FIELDS, ...(o.workflow ? ["--workflow", String(o.workflow)] : [])];
  const args = o.branch ? [...all, "--branch", o.branch] : all;
  const [runs, workflows, unfiltered] = await Promise.all([
    ctx.github.read(args, { maxAgeSeconds: o.maxAgeSeconds, timeoutMs: 25_000 }),
    // Workflows change rarely: kept 5 minutes unless read afresh.
    ctx.github.read(["workflow", "list", "--repo", repo, "--all", "--limit", "200", "--json", "id,name,path,state"], {
      maxAgeSeconds: o.maxAgeSeconds === 0 ? 0 : Math.max(o.maxAgeSeconds, 300),
      timeoutMs: 25_000,
    }),
    o.branch ? ctx.github.read(all, { maxAgeSeconds: o.maxAgeSeconds === 0 ? 0 : Math.max(o.maxAgeSeconds, 60), timeoutMs: 25_000 }) : undefined,
  ]);
  const list = parseRuns(runs.stdout);
  return {
    workflows: parseWorkflows(workflows.stdout),
    runs: list.slice(0, RUNS_LIMIT),
    truncated: list.length > RUNS_LIMIT,
    branches: branchesOf(unfiltered ? parseRuns(unfiltered.stdout) : list),
  };
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

/**
 * One run of `repo` with its jobs and steps, at its latest attempt or at `attempt`; failed jobs that have finished get
 * the end of their log. An earlier attempt is read with the latest one, which says how many there are.
 */
export async function viewRun(ctx: Gh, repo: string, id: number, o: { attempt?: number; maxAgeSeconds: number }): Promise<RunDetail> {
  const view = (attempt?: number) =>
    ctx.github.read(["run", "view", String(id), "--repo", repo, ...(attempt ? ["--attempt", String(attempt)] : []), "--json", `${RUN_FIELDS},jobs`], {
      maxAgeSeconds: o.maxAgeSeconds,
      timeoutMs: 25_000,
    });
  const [latest, chosen] = await Promise.all([view(), o.attempt ? view(o.attempt) : undefined]);
  const run = parseRunDetail((chosen ?? latest).stdout);
  if (!run) throw new Error(`gh returned no run ${id}`);
  const attempts = chosen ? parseRunDetail(latest.stdout)?.attempt : run.attempt;
  if (attempts) run.attempts = attempts;
  const failed = run.jobs.filter((j) => j.state === "failure" && j.completedAt);
  for (const job of failed.slice(LOGS_MAX)) job.logError = `ログは、失敗したジョブのうち最初の ${LOGS_MAX} 件だけ読みます。GitHub で見られます。`;
  await Promise.all(
    failed.slice(0, LOGS_MAX).map(async (job) => {
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
