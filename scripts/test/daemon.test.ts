import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { CallError, FAILED, fakeContext, loadDaemon, READ_ONLY } from "../../test/daemon.ts";
import { checkPlugins } from "../release.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const FIXTURE = "scripts/test/fixtures/daemon";

test("every plugin's daemon part loads, with its import.meta.glob, and defines the methods its gasho-plugin.json lists", async () => {
  const ids = checkPlugins(ROOT)
    .plugins.filter((p) => p.manifest.daemon)
    .map((p) => p.folder);
  assert.ok(ids.includes("github-implement") && ids.includes("kanban"));
  for (const id of ids) await loadDaemon(id);

  // The operations of github-implement and the board plugins of kanban are what their import.meta.glob found.
  const implement = await loadDaemon("github-implement");
  await assert.rejects(implement.call("read", { op: "comment" }, fakeContext().ctx), { message: "操作「comment」は write で呼んでください。" });
  const boards = (await import(pathToFileURL(path.join(ROOT, "kanban/src/daemon/board-plugins.ts")).href)) as { BOARD_FETCHERS: Map<string, unknown> };
  assert.deepEqual([...boards.BOARD_FETCHERS.keys()], ["example"]);
});

test("a daemon part whose methods are not those of its gasho-plugin.json is not loaded", async () => {
  await assert.rejects(loadDaemon("scripts/test/fixtures/daemon-mismatch"), {
    message: "daemon-mismatch: gasho-plugin.json lists the methods [echo, missing], its daemon part defines [close, crash, echo, refuse, sneak]",
  });
});

test("a call's params and result go through JSON, and only a PluginError's message reaches the person", async () => {
  const daemon = await loadDaemon(FIXTURE);
  const { ctx } = fakeContext({ session: { cwd: "/w/app", repos: [{ path: "lib" }] } });
  assert.deepEqual(await daemon.call("echo", { when: new Date(0), none: undefined }, ctx), {
    params: { when: "1970-01-01T00:00:00.000Z" },
    at: "1970-01-01T00:00:00.000Z",
    dir: "/w/app/lib",
  });
  // A repository gasho-daemon did not find in the session's folder.
  await assert.rejects(daemon.call("echo", {}, fakeContext({ session: { cwd: "/w/app" } }).ctx), { message: "このリポジトリは見つかりません。", user: true });

  await assert.rejects(daemon.call("refuse", {}, ctx), { name: "CallError", message: "この番号は読めません。", user: true });
  const crash = await daemon.call("crash", {}, ctx).catch((e: unknown) => e);
  assert.ok(crash instanceof CallError);
  assert.equal(crash.message, FAILED);
  assert.equal((crash.cause as Error).message, "an error of the code");
});

test("ctx.github runs the fake gh, and writes only in a method whose kind is write", async () => {
  const daemon = await loadDaemon(FIXTURE);
  const { ctx, calls } = fakeContext({ run: ({ command, args }) => (command === "gh" && args[0] === "issue" ? "closed\n" : "") });
  assert.equal(await daemon.call("close", {}, ctx), "closed\n");
  assert.deepEqual(calls, [{ command: "gh", args: ["issue", "close", "7", "--repo", "o/r"], via: "github.write", options: { repo: "o/r" } }]);
  await assert.rejects(daemon.call("sneak", {}, ctx), { message: READ_ONLY, user: true });
  assert.equal(calls.length, 1);
});
