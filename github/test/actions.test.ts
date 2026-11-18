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
  // home-assistant/core, run 44044536578: a workflow whose file GitHub could not read has no name, and never started.
  const broken = parseRuns(
    JSON.stringify([
      {
        attempt: 1,
        conclusion: "startup_failure",
        createdAt: "2026-11-17T08:10:52Z",
        databaseId: 44044536578,
        displayTitle: "Remove redundant manager check in Bluetooth config flow (#193043)",
        event: "push",
        headBranch: "dev",
        name: "",
        number: 15,
        startedAt: "2026-11-17T08:10:52Z",
        status: "completed",
        updatedAt: "2026-11-17T08:10:52Z",
        url: "https://github.com/home-assistant/core/actions/runs/44044536578",
        workflowDatabaseId: 1396333,
        workflowName: "",
      },
    ]),
  )[0];
  assert.deepEqual([broken?.workflow, broken?.state, broken?.startupFailure], ["", "failure", true]);
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
  // Waiting for someone to approve it (a fork's pull request): finished until then.
  assert.equal(runState("completed", "action_required"), "action_required");
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
  // vercel/next.js, run 44175381613: gh gives year 1 for times that have not come.
  const going = parseRunDetail(
    JSON.stringify({
      ...JSON.parse(fixture("run-failed.json")),
      status: "in_progress",
      conclusion: "",
      jobs: [
        {
          databaseId: 1,
          name: "build",
          status: "in_progress",
          conclusion: "",
          startedAt: "2026-11-17T21:02:02Z",
          completedAt: "0001-01-01T00:00:00Z",
          steps: [
            { number: 7, name: "Run actions/cache@27d5ce7", status: "in_progress", conclusion: "", startedAt: "2026-11-17T21:02:19Z", completedAt: "0001-01-01T00:00:00Z" },
            { number: 8, name: "Run pnpm install", status: "pending", conclusion: "", startedAt: "0001-01-01T00:00:00Z", completedAt: "0001-01-01T00:00:00Z" },
          ],
        },
      ],
    }),
  );
  const [goingJob] = going?.jobs ?? [];
  assert.deepEqual([goingJob?.startedAt, goingJob?.completedAt], ["2026-11-17T21:02:02Z", undefined]);
  assert.deepEqual(
    goingJob?.steps.map((st) => [st.state, st.startedAt, st.completedAt]),
    [
      ["in_progress", "2026-11-17T21:02:19Z", undefined],
      ["queued", undefined, undefined],
    ],
  );
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

test("a step before the failed one that ran in the same second is left out of its log", () => {
  const log = [
    "2026-11-17T10:00:04.1000000Z ##[group]Run npm ci",
    "2026-11-17T10:00:04.1100000Z npm ci",
    "2026-11-17T10:00:04.1200000Z ##[endgroup]",
    "2026-11-17T10:00:04.5000000Z up to date in 300ms",
    "2026-11-17T10:00:04.6000000Z ##[group]Run npm test",
    "2026-11-17T10:00:04.6100000Z npm test",
    "2026-11-17T10:00:04.6200000Z ##[endgroup]",
    "2026-11-17T10:00:05.3000000Z not ok 1 - adds",
    "2026-11-17T10:00:05.4000000Z ##[error]Process completed with exit code 1.",
    "2026-11-17T10:00:05.5000000Z Post job cleanup.",
  ].join("\n");
  // Step 5 (npm ci) started and ended at 10:00:04, when step 6 (npm test) started too.
  assert.deepEqual(logTail(log, { startedAt: "2026-11-17T10:00:04Z", completedAt: "2026-11-17T10:00:05Z" }), [
    "Run npm test",
    "npm test",
    "not ok 1 - adds",
    "Error: Process completed with exit code 1.",
  ]);
});

test("a step after the failed one that fails in the same second is left out of its log (real log)", () => {
  // grafana/grafana, job 134597618775: step 8 (the Playwright tests) fails at 05:30:31, when step 9 (`if: failure()`)
  // runs and fails too. The log is cut down to the lines around those, without the steps' env.
  const lines = logTail(fixture("job-log-same-second.txt"), { startedAt: "2026-11-18T05:24:52Z", completedAt: "2026-11-18T05:30:31Z" }, 1000);
  assert.equal(lines[0], "Run pnpm run e2e:playwright --shard=3/8 --reporter=dot,blob --output=playwright-test-results");
  assert.ok(lines.some((l) => l.includes("4 failed")));
  assert.equal(lines.at(-1), "Error: Process completed with exit code 1.");
  assert.ok(!lines.some((l) => l.includes("Tests in this shard failed") || l.includes("upload-artifact")));
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

test("with a branch chosen, the branches to choose from are still those of every branch's runs", async () => {
  const asked: string[][] = [];
  const ctx = {
    github: {
      read: async (args: string[]) => {
        asked.push(args);
        if (args[0] === "workflow") return { stdout: fixture("workflow-list.json"), stderr: "" };
        const runs = JSON.parse(fixture("run-list.json")) as { headBranch: string }[];
        const branch = args[args.indexOf("--branch") + 1];
        return { stdout: JSON.stringify(args.includes("--branch") ? runs.filter((r) => r.headBranch === branch) : runs), stderr: "" };
      },
    },
  };
  const all = await listRuns(ctx as never, "4rtofl/GashoPlugins", { maxAgeSeconds: 10 });
  assert.ok(all.branches.length > 1);
  const one = await listRuns(ctx as never, "4rtofl/GashoPlugins", { branch: all.branches[1], maxAgeSeconds: 10 });
  assert.ok(one.runs.every((r) => r.branch === all.branches[1]));
  assert.deepEqual(one.branches, all.branches);
  // The branches are read as the list without a branch is, so that gasho-daemon answers from what it kept of it.
  const lists = asked.filter((a) => a[0] === "run" && !a.includes("--branch")).map((a) => JSON.stringify(a));
  assert.equal(new Set(lists).size, 1);
});

test("an earlier attempt of a run is read with the latest, which says how many there are", async () => {
  const asked: string[][] = [];
  const latest = { ...JSON.parse(fixture("run-failed.json")), attempt: 2, conclusion: "success", jobs: [] };
  const first = { ...JSON.parse(fixture("run-failed.json")), attempt: 1 };
  const ctx = {
    github: {
      read: async (args: string[]) => {
        asked.push(args);
        if (args[0] === "run") return { stdout: JSON.stringify(args.includes("--attempt") ? first : latest), stderr: "" };
        return { stdout: fixture("job-log.txt"), stderr: "" };
      },
    },
  };
  const run = await viewRun(ctx as never, "4rtofl/GashoPlugins", 43632505661, { attempt: 1, maxAgeSeconds: 10 });
  assert.deepEqual([run.attempt, run.attempts, run.state], [1, 2, "failure"]);
  assert.ok(asked.some((a) => a.join(" ").includes("--attempt 1")));
  assert.equal(run.jobs[0]?.log?.at(-1), "Error: Process completed with exit code 1.");
  assert.equal((await viewRun(ctx as never, "4rtofl/GashoPlugins", 43632505661, { maxAgeSeconds: 10 })).attempts, 2);
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
