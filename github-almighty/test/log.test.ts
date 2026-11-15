import assert from "node:assert/strict";
import { test } from "node:test";
import { actionsIdArg, actionsJob } from "../src/daemon/detail/checks.ts";
import { parseLog } from "../src/daemon/ops/log.ts";

test("a check of GitHub Actions is known by its link, with ids past what numberArg takes", () => {
  const ids = actionsJob("https://github.com/4rtoflow/Gasho/actions/runs/43628523537/job/132549714426");
  assert.deepEqual(ids, { run: 43628523537, job: 132549714426 });
  assert.equal(actionsIdArg(ids?.job), 132549714426);
  assert.equal(actionsJob("https://github.com/4rtoflow/Gasho/actions/runs/43628523537"), undefined);
  assert.equal(actionsJob("https://ci.example.com/4rtoflow/Gasho/actions/runs/1/job/2"), undefined);
  assert.throws(() => actionsIdArg("132549714426"));
});

test("a failed job's log ends at its last error and starts at the step that failed", () => {
  const log = [
    "﻿2026-11-15T01:00:00.0000000Z Current runner version: '2.338.2'",
    "2026-11-15T01:00:01.0000000Z ##[group]Run npm ci",
    "2026-11-15T01:00:01.1000000Z npm ci",
    "2026-11-15T01:00:01.2000000Z ##[endgroup]",
    "2026-11-15T01:00:05.0000000Z added 120 packages",
    "2026-11-15T01:00:06.0000000Z ##[group]Run npm test",
    "2026-11-15T01:00:06.1000000Z npm test",
    "2026-11-15T01:00:06.2000000Z ##[endgroup]",
    "2026-11-15T01:00:07.0000000Z \u001b[31mnot ok 1 - adds\u001b[0m",
    "2026-11-15T01:00:07.1000000Z ##[warning]slow",
    "2026-11-15T01:00:08.0000000Z ##[error]Process completed with exit code 1.",
    "2026-11-15T01:00:09.0000000Z Post job cleanup.",
    "2026-11-15T01:00:09.1000000Z [command]/usr/bin/git version",
    "",
  ].join("\n");
  assert.deepEqual(parseLog(log), {
    lines: [
      { text: "Run npm test", level: "group" },
      { text: "npm test" },
      { text: "not ok 1 - adds" },
      { text: "slow", level: "warning" },
      { text: "Process completed with exit code 1.", level: "error" },
    ],
    cut: true,
  });
  // A step longer than the lines sent: its end only.
  const long = parseLog(log, 2);
  assert.deepEqual(long.lines.map((l) => l.text), ["slow", "Process completed with exit code 1."]);
  assert.equal(long.cut, true);
});

test("a log without an error shows its last lines", () => {
  const { lines, cut } = parseLog("2026-11-15T01:00:00Z one\n2026-11-15T01:00:01Z two\n2026-11-15T01:00:02Z three\n\n", 2);
  assert.deepEqual(lines, [{ text: "two" }, { text: "three" }]);
  assert.equal(cut, true);
});
