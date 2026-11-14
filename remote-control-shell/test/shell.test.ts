import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { OutputBuffer } from "../src/daemon/output.ts";
import { pickShell, SCRIPT, shellArgs, shellEnv, startupArgs } from "../src/daemon/shell.ts";

test("the shell: as set, or the person's SHELL when it speaks sh's language, else bash, else sh", () => {
  const all = () => true;
  assert.equal(pickShell("auto", "/usr/bin/zsh", all), "/usr/bin/zsh");
  assert.equal(pickShell("auto", "/bin/dash", all), "/bin/dash");
  assert.equal(pickShell("auto", "/usr/bin/fish", all), "/bin/bash");
  assert.equal(pickShell("auto", "zsh", all), "/bin/bash");
  assert.equal(pickShell("auto", "/usr/bin/zsh", (f) => f === "/opt/homebrew/bin/bash"), "/opt/homebrew/bin/bash");
  assert.equal(pickShell("auto", undefined, () => false), "/bin/sh");
  assert.equal(pickShell("zsh", "/bin/bash", all), "zsh");
  assert.deepEqual(startupArgs("login"), ["-l"]);
  assert.deepEqual(startupArgs("interactive"), ["-i"]);
  assert.deepEqual(startupArgs("plain"), []);
  assert.deepEqual(shellArgs("login", "/tmp/x.cwd", "ls"), ["-l", "-c", SCRIPT, "gasho-shell", "/tmp/x.cwd", "ls"]);
});

test("a command gets what sessions get from gasho-daemon, and nothing else of it", () => {
  const env = shellEnv(
    { PATH: "/usr/bin", HOME: "/home/a", SHELL: "/bin/zsh", GASHO_HOOK_SECRET: "s3cret", GASHO_HUB_URL: "ws://x", CLAUDECODE: "1", SSH_AUTH_SOCK: "/s" },
    { cwd: "/w", cols: 80 },
  );
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/home/a");
  assert.equal(env.LANG, "C.UTF-8");
  assert.equal(env.PWD, "/w");
  assert.equal(env.COLUMNS, "80");
  assert.equal(env.PAGER, "cat");
  assert.equal(env.GIT_EDITOR, "false");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  for (const key of Object.keys(env)) assert.ok(!key.startsWith("GASHO_") && key !== "CLAUDECODE" && key !== "SSH_AUTH_SOCK", key);
  assert.equal(shellEnv({ LANG: "ja_JP.UTF-8" }, { cwd: "/" }).LANG, "ja_JP.UTF-8");
  assert.equal(shellEnv({}, { cwd: "/" }).COLUMNS, undefined);
});

/** The shells of this machine that the script is written for. */
const shells = ["sh", "bash", "zsh", "dash"].flatMap((name) => {
  const dir = (process.env.PATH ?? "").split(":").find((d) => d && existsSync(path.join(d, name)));
  return dir ? [path.join(dir, name)] : [];
});

test("the script runs the command as written, keeps its exit status, and writes down where it ended", () => {
  assert.ok(shells.length > 0, "no shell found on PATH");
  const dir = mkdtempSync(path.join(os.tmpdir(), "rcs-script-"));
  try {
    for (const shell of shells) {
      const cwdFile = path.join(dir, `${path.basename(shell)}.cwd`);
      const command = "printf '%s\\n' \"a b\" \"$1\"\ncd / && echo moved; exit 3";
      const r = spawnSync(shell, ["-c", SCRIPT, "gasho-shell", cwdFile, command], { cwd: dir, encoding: "utf8" });
      assert.equal(r.status, 3, `${shell}: ${r.stderr}`);
      // The script's own arguments are gone before the command runs.
      assert.equal(r.stdout, "a b\n\nmoved\n", shell);
      assert.equal(readFileSync(cwdFile, "utf8"), "/\n", shell);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("output is kept from its end, dropped at a line's start, and read in stretches", () => {
  const out = new OutputBuffer(20);
  out.append("line1\nline2\n");
  assert.deepEqual([out.size, out.dropped, out.lines], [12, 0, 2]);
  out.append("line3\nline4\nline5\n");
  // Over the limit and an eighth: the start goes, up to a line's start.
  assert.equal(out.dropped, 12);
  assert.equal(out.text, "line3\nline4\nline5\n");
  assert.equal(out.lines, 5);
  assert.deepEqual(out.slice(0, 6), { from: 12, text: "line3\n" });
  assert.deepEqual(out.slice(24, 100), { from: 24, text: "line5\n" });
  assert.deepEqual(out.slice(99, 5), { from: 30, text: "" });
  out.final();
  assert.ok(out.text.length <= 20);
  // A surrogate pair is never split by a stretch's end, nor by a cut.
  const emoji = new OutputBuffer(100);
  emoji.append("a😀b");
  assert.deepEqual(emoji.slice(0, 2), { from: 0, text: "a" });
  const cut = new OutputBuffer(3);
  cut.append("😀😀😀");
  cut.final();
  assert.ok(!/^[\udc00-\udfff]/.test(cut.text), JSON.stringify(cut.text));
});
