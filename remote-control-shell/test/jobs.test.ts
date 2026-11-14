// The daemon part's commands, with real shells (sh) in folders of their own.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { DEFAULT_SETTINGS, Shells, type ShellSettings } from "../src/daemon/jobs.ts";
import type { ShellJob } from "../src/types.ts";

const root = mkdtempSync(path.join(os.tmpdir(), "rcs-jobs-"));
after(() => rmSync(root, { recursive: true, force: true }));

const SH: ShellSettings = { ...DEFAULT_SETTINGS, shell: "sh", startup: "plain" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let count = 0;
/** A session folder and a plugin folder of their own. */
function setup(env: NodeJS.ProcessEnv = process.env) {
  const base = path.join(root, String(count++));
  const folder = path.join(base, "work");
  mkdirSync(folder, { recursive: true });
  const dataDir = path.join(base, "data");
  return { folder, dataDir, shells: new Shells({ dataDir, env }) };
}

/** Follows a command with `watch`, as the panel does, until it has ended and its output is read: its record and output. */
async function settle(s: Shells, folder: string, id: string): Promise<{ job: ShellJob; text: string }> {
  let since: string | undefined;
  let text = "";
  let at = 0;
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    const v = await s.watch(folder, { ...(since ? { since } : {}), offsets: { [id]: at }, waitMs: 2000 });
    since = v.version;
    const piece = v.output[id];
    if (piece) {
      text = piece.from === at ? text + piece.text : piece.text;
      at = piece.from + piece.text.length;
    }
    const job = v.jobs.find((j) => j.id === id);
    assert.ok(job, `no record ${id}`);
    if (job.state !== "running" && at >= job.size) {
      await s.idle();
      return { job, text };
    }
  }
  throw new Error(`${id} did not end`);
}

test("a command's output, from both streams, and its exit code are recorded", async () => {
  const { folder, shells } = setup();
  try {
    const started = await shells.run(folder, { command: "printf 'out\\n'; printf 'err\\n' >&2; exit 3" }, SH);
    assert.deepEqual([started.state, started.cwd], ["running", folder]);
    const { job, text } = await settle(shells, folder, started.id);
    assert.deepEqual([job.state, job.exitCode, job.lines], ["exited", 3, 2]);
    assert.ok(job.endedAt !== undefined && job.endedAt >= job.startedAt);
    assert.deepEqual(text.split("\n").sort(), ["", "err", "out"]);
  } finally {
    await shells.stop();
  }
});

test("cd carries over to the next command, only from the command started last; chdir and a gone folder lead back", async () => {
  const { folder, shells } = setup();
  try {
    const sub = path.join(folder, "sub");
    await settle(shells, folder, (await shells.run(folder, { command: "mkdir -p sub && cd sub" }, SH)).id);
    const pwd = await settle(shells, folder, (await shells.run(folder, { command: "pwd" }, SH)).id);
    assert.deepEqual([pwd.text, pwd.job.cwd], [`${sub}\n`, sub]);
    // A command that ends after a later one started does not move the working folder.
    const slow = await shells.run(folder, { command: "sleep 0.4; cd /" }, SH);
    const quick = await shells.run(folder, { command: "true" }, SH);
    await settle(shells, folder, quick.id);
    await settle(shells, folder, slow.id);
    assert.equal((await shells.watch(folder, { offsets: {}, waitMs: 0 })).cwd, sub);
    assert.deepEqual(await shells.chdir(folder, folder), { cwd: folder });
    assert.equal((await shells.watch(folder, { offsets: {}, waitMs: 0 })).cwd, folder);
    // Run again: the command runs where it ran first, and does not move the working folder by that.
    const inSub = await shells.run(folder, { again: pwd.job.id }, SH);
    const rerun = await settle(shells, folder, inSub.id);
    assert.deepEqual([rerun.job.cwd, rerun.text], [sub, `${sub}\n`]);
    assert.equal((await shells.watch(folder, { offsets: {}, waitMs: 0 })).cwd, folder);
    // The working folder has gone: the command runs in the session's folder, and its record says so.
    const gone = path.join(folder, "gone");
    mkdirSync(gone);
    await shells.chdir(folder, gone);
    rmSync(gone, { recursive: true });
    const fallback = await settle(shells, folder, (await shells.run(folder, { command: "pwd" }, SH)).id);
    assert.equal(fallback.text, `${folder}\n`);
    assert.match(fallback.job.note ?? "", /がないので、セッションのフォルダーで実行しました/);
  } finally {
    await shells.stop();
  }
});

test("SIGINT stops a command, and SIGKILL one that ignores SIGINT", async () => {
  const { folder, shells } = setup();
  try {
    const sleeping = await shells.run(folder, { command: "sleep 30" }, SH);
    await sleep(200);
    await shells.signal(folder, sleeping.id, "INT");
    const a = await settle(shells, folder, sleeping.id);
    assert.deepEqual([a.job.state, a.job.signal], ["stopped", "SIGINT"]);
    const stubborn = await shells.run(folder, { command: "trap '' INT; sleep 30" }, SH);
    await sleep(200);
    await shells.signal(folder, stubborn.id, "INT");
    await sleep(300);
    assert.equal((await shells.status(folder)).running, 1);
    await shells.signal(folder, stubborn.id, "KILL");
    const b = await settle(shells, folder, stubborn.id);
    assert.deepEqual([b.job.state, b.job.signal], ["stopped", "SIGKILL"]);
  } finally {
    await shells.stop();
  }
});

test("output beyond the limit is dropped from its start, at a line's start", async () => {
  const { folder, shells } = setup();
  try {
    const command = "i=0; while [ $i -lt 500 ]; do echo line$i; i=$((i+1)); done";
    const started = await shells.run(folder, { command }, { ...SH, maxOutput: 1000 });
    const { job, text } = await settle(shells, folder, started.id);
    assert.equal(job.lines, 500);
    assert.ok(job.dropped > 0 && job.size - job.dropped <= 1000, JSON.stringify(job));
    assert.ok(text.endsWith("line499\n"));
    const kept = await shells.output(folder, job.id, 0, 5000);
    assert.equal(kept.from, job.dropped);
    assert.ok(kept.text.startsWith("line") && kept.text.endsWith("line499\n") && kept.text.length <= 1000);
  } finally {
    await shells.stop();
  }
});

test("watch waits for a change, and answers as soon as output comes", async () => {
  const { folder, shells } = setup();
  try {
    const started = await shells.run(folder, { command: "sleep 0.3; echo late" }, SH);
    const first = await shells.watch(folder, { offsets: { [started.id]: 0 }, waitMs: 0 });
    const t0 = Date.now();
    const next = await shells.watch(folder, { since: first.version, offsets: { [started.id]: 0 }, waitMs: 5000 });
    const waited = Date.now() - t0;
    assert.ok(waited >= 150 && waited < 4000, `${waited} ms`);
    assert.equal(next.output[started.id]?.text, "late\n");
    // Nothing new: it waits the whole time.
    const done = await settle(shells, folder, started.id);
    const quiet = await shells.watch(folder, { since: (await shells.watch(folder, { offsets: {}, waitMs: 0 })).version, offsets: { [started.id]: done.job.size }, waitMs: 300 });
    assert.deepEqual(quiet.output, {});
  } finally {
    await shells.stop();
  }
});

test("records, their output and the working folder outlast the plugin's process; stop ends what runs", async () => {
  const { folder, dataDir, shells } = setup();
  const done = await shells.run(folder, { command: "mkdir -p keep && cd keep && echo kept" }, SH);
  await settle(shells, folder, done.id);
  const running = await shells.run(folder, { command: "sleep 30" }, SH);
  const t0 = Date.now();
  await shells.stop();
  assert.ok(Date.now() - t0 < 5000, "stop took too long");
  await assert.rejects(shells.run(folder, { command: "true" }, SH), /止まるところ/);

  const again = new Shells({ dataDir });
  try {
    const v = await again.watch(folder, { offsets: {}, waitMs: 0 });
    assert.equal(v.cwd, path.join(folder, "keep"));
    assert.deepEqual(
      v.jobs.map((j) => [j.id, j.state]),
      [
        [done.id, "exited"],
        [running.id, "lost"],
      ],
    );
    assert.equal((await again.output(folder, done.id, 0, 100)).text, "kept\n");
    assert.equal((await again.status(folder)).running, 0);
    // Again: the same command, in the folder it ran in.
    const re = await again.run(folder, { again: done.id }, SH);
    assert.equal(re.cwd, folder);
    assert.equal((await settle(again, folder, re.id)).text, "kept\n");
    await assert.rejects(again.clear(folder, "zzzzzzzz-000000"), /見つかりません/);
    assert.deepEqual(await again.clear(folder, undefined), { removed: 3 });
    assert.equal((await again.watch(folder, { offsets: {}, waitMs: 0 })).jobs.length, 0);
  } finally {
    await again.stop();
  }
});

test("gasho-daemon's own variables do not reach a command", async () => {
  const { folder, shells } = setup({ ...process.env, GASHO_HOOK_SECRET: "s3cret", GASHO_PLUGIN: "remote-control-shell" });
  try {
    const { text } = await settle(shells, folder, (await shells.run(folder, { command: "env" }, SH)).id);
    assert.doesNotMatch(text, /GASHO_|s3cret/);
    assert.match(text, /^PAGER=cat$/m);
    assert.ok(text.split("\n").includes(`PWD=${folder}`), text);
  } finally {
    await shells.stop();
  }
});

test("a folder runs four commands at once at most, and a shell that is not there is recorded as such", async () => {
  const { folder, shells } = setup();
  try {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await shells.run(folder, { command: "sleep 30" }, SH)).id);
    await assert.rejects(shells.run(folder, { command: "true" }, SH), /すでに4つのコマンドが動いています/);
    await assert.rejects(shells.clear(folder, ids[0]), /実行中のコマンドの記録は消せません/);
    for (const id of ids) await shells.signal(folder, id, "KILL");
    for (const id of ids) await settle(shells, folder, id);
  } finally {
    await shells.stop();
  }
  const bare = setup({ PATH: "/nonexistent", HOME: os.homedir() });
  try {
    const started = await bare.shells.run(bare.folder, { command: "true" }, SH);
    const { job } = await settle(bare.shells, bare.folder, started.id);
    assert.equal(job.state, "failed");
    assert.match(job.note ?? "", /シェル（sh）が見つかりません/);
  } finally {
    await bare.shells.stop();
  }
});
