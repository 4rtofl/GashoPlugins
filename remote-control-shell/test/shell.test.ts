import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { OutputBuffer } from "../src/daemon/output.ts";
import { pickShell, SCRIPT_START, shellArgs, shellEnv, startupArgs } from "../src/daemon/shell.ts";

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
  assert.deepEqual(shellArgs("login", "/bin/zsh", "/tmp/x.cwd", "ls"), ["-l", "-c", `${SCRIPT_START}ls`, "zsh", "/tmp/x.cwd"]);
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
      const name = path.basename(shell);
      const cwdFile = path.join(dir, `${name}.cwd`);
      const command = "printf '%s\\n' \"a b\" \"$1\"\ncd / && echo moved; exit 3";
      const r = spawnSync(shell, shellArgs("plain", shell, cwdFile, command), { cwd: dir, encoding: "utf8" });
      assert.equal(r.status, 3, `${shell}: ${r.stderr}`);
      // The script's own arguments are gone before the command runs.
      assert.equal(r.stdout, "a b\n\nmoved\n", shell);
      assert.equal(readFileSync(cwdFile, "utf8"), "/\n", shell);
      // Errors read as a terminal's, at the command's own line: "zsh:1: …", "bash: line 1: …", "dash: 1: …" (macOS's
      // bash 3.2 gives no line), never "(eval):1:" or the script's line.
      const missing = spawnSync(shell, shellArgs("plain", shell, path.join(dir, "x.cwd"), "rcs_no_such_command"), { cwd: dir, encoding: "utf8" });
      assert.match(missing.stderr, new RegExp(`^${name}(: line 1|:1|: 1)?: `), `${shell}: ${missing.stderr}`);
      assert.equal(missing.status, 127, shell);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Runs the script in `shell -i` in a group of its own, sends `signal` to the group once the command says "ready": its exit status. */
function interrupted(shell: string, home: string, command: string, signal: NodeJS.Signals = "SIGINT"): Promise<number | NodeJS.Signals | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(shell, shellArgs("interactive", shell, path.join(home, "cwd"), command), {
      cwd: home,
      env: { PATH: process.env.PATH ?? "", HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const group = (signal: NodeJS.Signals) => {
      try {
        process.kill(-child.pid!, signal);
      } catch {
        // Gone already.
      }
    };
    const timer = setTimeout(() => {
      group("SIGKILL");
      reject(new Error(`${shell}: ${signal} did not end "${command}"`));
    }, 15_000);
    let out = "";
    child.stdout.on("data", (b: Buffer) => {
      const was = out;
      out += b.toString();
      if (!was.includes("ready") && out.includes("ready")) group(signal);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve(code ?? signal);
    });
  });
}

test("in an interactive shell, SIGINT and SIGTERM to the shell's group reach the command; the script ends with its status", async () => {
  // Startup files of its own, so that none of the person's runs (zsh asks to make one when there is none).
  const home = mkdtempSync(path.join(os.tmpdir(), "rcs-int-"));
  for (const rc of [".bashrc", ".zshrc"]) writeFileSync(path.join(home, rc), "");
  try {
    for (const shell of shells) {
      // The command waits in a process of its own, as a program does: one an interactive bash 3.2 would put in a group apart.
      assert.equal(await interrupted(shell, home, "sh -c 'echo ready; exec sleep 30'"), 130, shell);
      // Ended by itself after the signal: its own code, not the signal's.
      assert.equal(await interrupted(shell, home, "sh -c \"trap '' INT; echo ready; sleep 0.3; exit 3\""), 3, shell);
      // SIGTERM (the plugin stops): nothing after `;` runs, though an interactive shell ignores SIGTERM.
      const after = path.join(home, "went-on");
      assert.equal(await interrupted(shell, home, `sh -c 'echo ready; exec sleep 30'; touch '${after}'`, "SIGTERM"), 143, shell);
      assert.ok(!existsSync(after), shell);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("output is kept from its end, dropped at a line's start, and read in stretches", () => {
  const out = new OutputBuffer(20);
  out.append("line1\nline2\n");
  assert.deepEqual([out.size, out.dropped, out.lines], [12, 0, 2]);
  out.append("line3\nline4\nline5\n");
  // Over the limit and an eighth: the start goes, up to a line's start. Lines count what is kept.
  assert.equal(out.dropped, 12);
  assert.equal(out.text, "line3\nline4\nline5\n");
  assert.equal(out.lines, 3);
  // A last line without a newline is a line too.
  const long = new OutputBuffer(100, { text: "a\n", dropped: 0 });
  long.append("x".repeat(50));
  assert.equal(long.lines, 2);
  assert.deepEqual(out.slice(0, 6), { from: 12, text: "line3\n" });
  assert.deepEqual(out.slice(24, 100), { from: 24, text: "line5\n" });
  assert.deepEqual(out.slice(99, 5), { from: 30, text: "" });
  out.final();
  assert.ok(out.text.length <= 20);
  // A surrogate pair is never split by a stretch's end or start, nor by a cut.
  const emoji = new OutputBuffer(100);
  emoji.append("a😀b");
  assert.deepEqual(emoji.slice(0, 2), { from: 0, text: "a" });
  assert.deepEqual(emoji.slice(2, 2), { from: 1, text: "😀b" });
  const cut = new OutputBuffer(3);
  cut.append("😀😀😀");
  cut.final();
  assert.ok(!/^[\udc00-\udfff]/.test(cut.text), JSON.stringify(cut.text));
});
