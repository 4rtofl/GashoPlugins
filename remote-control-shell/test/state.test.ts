import assert from "node:assert/strict";
import { test } from "node:test";
import type { ShellJob, ShellView } from "../src/types.ts";
import { commandHistory, commandSummary, duration, folderLabel, insideFolder } from "../src/web/format.ts";
import { addJob, EMPTY_STATE, FIRST_ENDED, FIRST_RUNNING, FOLLOWED, joinPiece, mergeView, offsetsFor, RUNNING_WINDOW, trimWindow } from "../src/web/state.ts";

const job = (id: string, over: Partial<ShellJob> = {}): ShellJob => ({
  id,
  command: "true",
  cwd: "/w",
  startedAt: 1000,
  state: "exited",
  exitCode: 0,
  size: 0,
  dropped: 0,
  lines: 0,
  ...over,
});

const view = (over: Partial<ShellView> = {}): ShellView => ({ version: "e.1", folder: "/w", cwd: "/w", home: "/h", now: 5000, jobs: [], output: {}, ...over });

test("the panel reads the end of each command first, follows running ones, and leaves out ended ones it has whole", () => {
  const s = {
    ...EMPTY_STATE,
    jobs: [
      job("a", { state: "running", size: 100_000 }),
      job("b", { size: 10_000 }),
      job("c", { size: 5000, dropped: 3000 }),
      job("d", { size: 0 }),
      job("e", { state: "running", size: 0 }),
      job("f", { size: 30 }),
      job("g", { state: "running", size: 40 }),
    ],
    windows: { f: { from: 0, text: "x".repeat(30) }, g: { from: 0, text: "y".repeat(40) } },
  };
  assert.deepEqual(offsetsFor(s), { a: 100_000 - FIRST_RUNNING, b: 10_000 - FIRST_ENDED, c: 3000, e: 0, g: 40 });
  // More records than it follows (keepJobs is over 50): an older command is still followed while it runs.
  const newer = Array.from({ length: FOLLOWED }, (_, i) => job(`n${i}`, { size: 10 }));
  const many = { ...EMPTY_STATE, jobs: [job("old", { state: "running", size: 10 }), job("done", { size: 10 }), ...newer] };
  assert.deepEqual(Object.keys(offsetsFor(many)), ["old", ...newer.map((j) => j.id)]);
});

test("an answer continues the windows, replaces one past a gap, and forgets records that went", () => {
  const before = {
    ...EMPTY_STATE,
    jobs: [job("a", { state: "running", size: 3 }), job("gone")],
    windows: { a: { from: 0, text: "abc" }, gone: { from: 0, text: "x" } },
  };
  const after = mergeView(
    before,
    view({ jobs: [job("a", { state: "running", size: 6 }), job("b", { size: 9 })], output: { a: { from: 3, text: "def" }, b: { from: 5, text: "6789" } } }),
    4000,
  );
  assert.deepEqual(after.windows, { a: { from: 0, text: "abcdef" }, b: { from: 5, text: "6789" } });
  assert.equal(after.skew, 1000);
  assert.equal(after.loaded, true);
  assert.equal(after.cwd, "/w");
  // Output dropped on the working server: the window starts again from what came.
  assert.deepEqual(mergeView(after, view({ jobs: after.jobs, output: { a: { from: 100, text: "z" } } }), 0).windows.a, { from: 100, text: "z" });
  // A running command's window keeps its end only.
  const big = mergeView(EMPTY_STATE, view({ jobs: [job("a", { state: "running", size: RUNNING_WINDOW + 10 })], output: { a: { from: 0, text: "q".repeat(RUNNING_WINDOW + 10) } } }), 0);
  assert.deepEqual([big.windows.a?.from, big.windows.a?.text.length], [10, RUNNING_WINDOW]);
});

test("pieces join a window before it, after it and over it; one apart takes its place", () => {
  const w = { from: 10, text: "klmno" };
  assert.deepEqual(joinPiece(w, { from: 5, text: "fghij" }), { from: 5, text: "fghijklmno" });
  assert.deepEqual(joinPiece(w, { from: 8, text: "ijk" }), { from: 8, text: "ijklmno" });
  assert.deepEqual(joinPiece(w, { from: 15, text: "pq" }), { from: 10, text: "klmnopq" });
  assert.deepEqual(joinPiece(w, { from: 12, text: "M" }), { from: 10, text: "klMno" });
  assert.deepEqual(joinPiece(w, { from: 0, text: "ab" }), { from: 0, text: "ab" });
  assert.deepEqual(joinPiece(undefined, { from: 3, text: "d" }), { from: 3, text: "d" });
  assert.deepEqual(trimWindow({ from: 0, text: "aaaa\nbbbb\ncc" }, 9), { from: 5, text: "bbbb\ncc" });
  const started = addJob(EMPTY_STATE, job("n", { state: "running" }));
  assert.equal(addJob(started, job("n")), started);
});

test("times, folders and the operations log's summary are written as the panel shows them", () => {
  assert.equal(duration(3), "0.1秒未満");
  assert.equal(duration(300), "0.3秒");
  assert.equal(duration(9_999), "9.9秒");
  assert.equal(duration(12_500), "12秒");
  assert.equal(duration(65_000), "1分5秒");
  assert.equal(duration(3_725_000), "1時間2分");
  assert.equal(duration(-50), "0.1秒未満");
  const folder = "/home/rg/repos/Gasho";
  assert.equal(folderLabel(folder, folder, "/home/rg"), "Gasho");
  assert.equal(folderLabel(`${folder}/apps/web`, folder, "/home/rg"), "Gasho/apps/web");
  assert.equal(folderLabel("/home/rg/repos/Gasho2", folder, "/home/rg"), "~/repos/Gasho2");
  assert.equal(folderLabel("/home/rg", folder, "/home/rg"), "~");
  assert.equal(folderLabel("/etc", folder, "/home/rg"), "/etc");
  assert.ok(insideFolder(`${folder}/x`, folder) && insideFolder(folder, folder) && !insideFolder(`${folder}2`, folder));
  assert.equal(commandSummary("  npm test \n"), "$ npm test");
  assert.equal(commandSummary("cd app\nnpm test"), "$ cd app …");
  assert.deepEqual(commandHistory(["ls", "ls", "git status", "ls"]), ["ls", "git status", "ls"]);
});
