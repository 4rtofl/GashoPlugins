import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { listRuns, logTail, LOGS_MAX, parseRunDetail, parseRuns, parseWorkflows, runState, viewRun } from "../src/daemon/actions.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

test("gh run list's runs are read (real output), and anything odd is left out", () => {
  const runs = parseRuns(fixture("run-list.json"));
  assert.equal(runs.length, 6);
  assert.deepEqual(runs[0], {
    id: 43713374887,
    number: 82,
    workflow: "Plugins",
    workflowId: 418449472,
    title: "Merge pull request #90 from 4rtofl/feat/81-tab-icon",
    branch: "main",
    event: "push",
    state: "success",
    attempt: 1,
    createdAt: "2026-11-15T12:20:55Z",
    startedAt: "2026-11-15T12:20:55Z",
    updatedAt: "2026-11-15T12:21:25Z",
    url: "https://github.com/4rtofl/GashoPlugins/actions/runs/43713374887",
  });
  assert.deepEqual(parseRuns(JSON.stringify([{ databaseId: 1, url: "javascript:alert(1)" }, { url: "https://github.com/o/r/actions/runs/2" }, null])), []);
  assert.deepEqual(parseRuns("not json"), []);
});

test("gh workflow list's workflows are read (real output)", () => {
  assert.deepEqual(parseWorkflows(fixture("workflow-list.json")), [{ id: 418449472, name: "Plugins", path: ".github/workflows/release.yml", active: true }]);
  assert.deepEqual(parseWorkflows(JSON.stringify([{ id: 2, name: "Old", path: "x.yml", state: "disabled_manually" }])), [{ id: 2, name: "Old", path: "x.yml", active: false }]);
});

test("a run's, job's or step's state comes from its status and conclusion", () => {
  assert.equal(runState("completed", "success"), "success");
  assert.equal(runState("completed", "failure"), "failure");
  assert.equal(runState("completed", "timed_out"), "failure");
  assert.equal(runState("completed", "startup_failure"), "failure");
  assert.equal(runState("completed", "cancelled"), "cancelled");
  assert.equal(runState("completed", "skipped"), "skipped");
  assert.equal(runState("completed", "action_required"), "waiting");
  assert.equal(runState("in_progress", ""), "in_progress");
  assert.equal(runState("queued", ""), "queued");
  assert.equal(runState("pending", ""), "queued");
  assert.equal(runState("waiting", ""), "waiting");
});

test("gh run view's run is read with its jobs and steps (real output)", () => {
  const run = parseRunDetail(fixture("run-failed.json"));
  assert.ok(run);
  assert.equal(run.state, "failure");
  assert.equal(run.jobs.length, 1);
  const job = run.jobs[0];
  assert.ok(job);
  assert.equal(job.name, "plugins");
  assert.equal(job.state, "failure");
  assert.match(job.url ?? "", /^https:\/\/github\.com\/4rtofl\/GashoPlugins\/actions\/runs\/43632505661\/job\/132562013692$/);
  assert.deepEqual(
    job.steps.filter((s) => s.state !== "success").map((s) => [s.number, s.name, s.state]),
    [
      [6, "Run npm test", "failure"],
      [7, "Run npm run build", "skipped"],
      [8, "Run node scripts/release.ts", "skipped"],
      [15, "Post Run actions/setup-node@v4", "skipped"],
    ],
  );
  assert.equal(parseRunDetail("{}"), undefined);
});

test("a failed job's log is cut to the step that failed, without timestamps, colors and group markers (real log)", () => {
  const run = parseRunDetail(fixture("run-failed.json"));
  const step = run?.jobs[0]?.steps.find((s) => s.state === "failure");
  const lines = logTail(fixture("job-log.txt"), step, 1000);
  assert.equal(lines[0], "Run npm test");
  assert.equal(lines[1], "npm test");
  assert.equal(lines.at(-1), "Error: Process completed with exit code 1.");
  assert.ok(!lines.some((l) => l.includes("Post job cleanup") || l.includes("##[") || /\x1b/.test(l) || /^\d{4}-\d\d-\d\dT/.test(l)));
  assert.ok(lines.some((l) => l.includes("ERR_ASSERTION")));
  // Only the end is kept.
  const tail = logTail(fixture("job-log.txt"), step, 5);
  assert.deepEqual(tail, lines.slice(-5));
  // Without the step's times: the end of the whole log.
  assert.match(logTail(fixture("job-log.txt"), undefined, 3).at(-1) ?? "", /^Warning: Node\.js 20 is deprecated/);
  // Long lines are cut, and never inside an emoji.
  assert.ok((logTail(`2026-01-01T00:00:00.0000000Z ${"x".repeat(900)}`)[0]?.length ?? 0) <= 501);
  assert.equal(logTail(`2026-01-01T00:00:00.0000000Z ${"x".repeat(499)}👨‍👩‍👧 and more`)[0], `${"x".repeat(499)}…`);
  assert.equal(logTail(`2026-01-01T00:00:00.0000000Z ${"x".repeat(498)}👍 and more`)[0], `${"x".repeat(498)}👍…`);
});

test("a step of a composite action that fails: its error ends the log, not the first step inside (real log)", () => {
  // microsoft/playwright, job 134085053730: step 6 runs ./.github/actions/run-test, whose `npm run itest` fails, and
  // whose steps after it run anyway. The log is cut down to the lines around those.
  const step = { startedAt: "2026-11-17T13:49:26Z", completedAt: "2026-11-17T14:07:17Z" };
  const lines = logTail(fixture("job-log-composite.txt"), step);
  assert.equal(lines.at(-1), "Error: Process completed with exit code 1.");
  assert.ok(lines.some((l) => l.includes("10 failed")));
  assert.ok(!lines.some((l) => l.includes("##[") || l.includes("upload-blob-report")));
});

test("failed jobs beyond those whose log is read say so", async () => {
  const one = JSON.parse(fixture("run-failed.json")) as { jobs: Record<string, unknown>[] };
  const failedJob = one.jobs[0] ?? {};
  one.jobs = Array.from({ length: LOGS_MAX + 2 }, (_, i) => ({ ...failedJob, databaseId: 1000 + i }));
  const logs: string[] = [];
  const ctx = {
    github: {
      read: async (args: string[]) => {
        if (args[0] === "run") return { stdout: JSON.stringify(one), stderr: "" };
        logs.push(args.at(-1) ?? "");
        return { stdout: fixture("job-log.txt"), stderr: "" };
      },
    },
  };
  const run = await viewRun(ctx as never, "4rtofl/GashoPlugins", 1, { maxAgeSeconds: 10 });
  assert.equal(logs.length, LOGS_MAX);
  assert.ok(run.jobs.every((j) => (j.log?.length ?? 0) > 0 || j.logError));
  assert.match(run.jobs.at(-1)?.logError ?? "", /最初の 3 件/);
});

test("reading again reads the workflows again too", async () => {
  const ages: (number | undefined)[] = [];
  const ctx = {
    github: {
      read: async (args: string[], o?: { maxAgeSeconds?: number }) => {
        if (args[0] === "workflow") ages.push(o?.maxAgeSeconds);
        return { stdout: args[0] === "workflow" ? fixture("workflow-list.json") : fixture("run-list.json"), stderr: "" };
      },
    },
  };
  await listRuns(ctx as never, "4rtofl/GashoPlugins", { maxAgeSeconds: 10 });
  await listRuns(ctx as never, "4rtofl/GashoPlugins", { maxAgeSeconds: 0 });
  assert.deepEqual(ages, [300, 0]);
});

test("a run is read with the end of its failed jobs' logs; gh without --allow-escape-sequences is asked again without it", async () => {
  const asked: string[][] = [];
  const ctx = {
    github: {
      read: async (args: string[]) => {
        asked.push(args);
        if (args[0] === "run") return { stdout: fixture("run-failed.json"), stderr: "" };
        if (args.includes("--allow-escape-sequences")) throw Object.assign(new Error("failed"), { stderr: "unknown flag: --allow-escape-sequences", stdout: "" });
        return { stdout: fixture("job-log.txt"), stderr: "" };
      },
    },
  };
  const run = await viewRun(ctx as never, "4rtofl/GashoPlugins", 43632505661, { maxAgeSeconds: 10 });
  assert.equal(run.jobs[0]?.log?.at(-1), "Error: Process completed with exit code 1.");
  assert.deepEqual(asked.slice(1), [
    ["api", "--allow-escape-sequences", "repos/4rtofl/GashoPlugins/actions/jobs/132562013692/logs"],
    ["api", "repos/4rtofl/GashoPlugins/actions/jobs/132562013692/logs"],
  ]);
  const gone = await viewRun(
    { github: { read: async (args: string[]) => (args[0] === "run" ? { stdout: fixture("run-failed.json"), stderr: "" } : Promise.reject(Object.assign(new Error("x"), { stderr: "gh: Not Found (HTTP 410)" }))) } } as never,
    "4rtofl/GashoPlugins",
    1,
    { maxAgeSeconds: 10 },
  );
  assert.equal(gone.jobs[0]?.logError, "ログはもう GitHub にありません。");
});
