// How a command is started (README.md「コマンドの起動」): which shell, with which switches and environment, and the short
// script before the command that, as the shell ends, writes down the folder it ended in.
import path from "node:path";

export type ShellChoice = "auto" | "bash" | "zsh" | "sh";
export type Startup = "login" | "interactive" | "plain";

/** Shells that understand the script below (sh's language). */
const SH_LIKE = new Set(["bash", "zsh", "sh", "dash", "ksh", "mksh"]);
const BASH = ["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash", "/opt/homebrew/bin/bash"];

/**
 * The shell to start. A shell named in the settings is looked up on PATH; "auto" takes the person's SHELL when it
 * understands sh's language, else bash, else /bin/sh.
 */
export function pickShell(choice: ShellChoice, envShell: string | undefined, exists: (file: string) => boolean): string {
  if (choice !== "auto") return choice;
  if (envShell && path.isAbsolute(envShell) && SH_LIKE.has(path.basename(envShell)) && exists(envShell)) return envShell;
  return BASH.find(exists) ?? "/bin/sh";
}

export function startupArgs(startup: Startup): string[] {
  return startup === "login" ? ["-l"] : startup === "interactive" ? ["-i"] : [];
}

/**
 * What the shell runs: `<shell> -c "SCRIPT_START<command>" <shell's name> <cwd file>`. The command is the rest of the
 * script, from its first line on, so that the shell reports its errors as a terminal does ("zsh:2: command not found:
 * x", "bash: line 2: …") with the command's own line numbers, and it may span lines. The cwd file is shifted off before
 * the command runs; however the shell then ends (also by `exit` in the command), the EXIT trap writes the folder it is in
 * to it, for the next command (README.md「作業フォルダー」). The trap keeps the command's exit status.
 *
 * `set +m`: an interactive bash 3.2 (macOS's /bin/bash and /bin/sh) puts each command in a process group of its own,
 * which the signals sent to the shell's group would miss. On SIGINT or SIGTERM the shell ends once the command has, with
 * the command's status: 128 + the signal's number when the signal ended it, its own code when it ended by itself. A
 * shell left to itself would, on SIGINT, end at once (zsh) or with 1 (an interactive bash), whatever the command did,
 * and an interactive one would, on SIGTERM (stop()), go on to the commands after `;` (README.md「止める」).
 */
/** The signals the script's trap catches: the shell ends with 128 + the number of the one that ended the command. */
export const CAUGHT: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

export const SCRIPT_START = `set +m; trap 'exit $?' INT TERM; __gasho_cwd_file=$1; shift; trap 'pwd > "$__gasho_cwd_file" 2>/dev/null' EXIT; `;

export function shellArgs(startup: Startup, shell: string, cwdFile: string, command: string): string[] {
  return [...startupArgs(startup), "-c", SCRIPT_START + command, path.basename(shell), cwdFile];
}

/** What a command inherits from gasho-daemon: what gasho-daemon gives the terminals of sessions (its cleanEnv). */
const INHERITED = ["HOME", "USER", "LOGNAME", "PATH", "SHELL", "LANG", "LC_ALL", "XDG_RUNTIME_DIR", "TMPDIR"];

/**
 * The environment of a command: the variables above, and what lets it print colors, keeps git and gh from paging or
 * waiting for an answer, makes a command that opens an editor fail at once (there is no terminal to type in), and keeps
 * Python from holding its output back (its output goes to a pipe; README.md「出力をためるプログラム」).
 * Nothing else of gasho-daemon's (GASHO_HOOK_SECRET, …) gets through. PWD names the folder as given, so that `pwd`
 * keeps the path the session uses rather than where its links lead.
 */
export function shellEnv(base: NodeJS.ProcessEnv, opts: { cwd: string; cols?: number }): Record<string, string> {
  const env: Record<string, string> = { LANG: "C.UTF-8" };
  for (const key of INHERITED) {
    const value = base[key];
    if (value) env[key] = value;
  }
  Object.assign(env, {
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    FORCE_COLOR: "1",
    CLICOLOR_FORCE: "1",
    PAGER: "cat",
    GIT_PAGER: "cat",
    GH_PAGER: "cat",
    MANPAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    GH_PROMPT_DISABLED: "1",
    EDITOR: "false",
    VISUAL: "false",
    GIT_EDITOR: "false",
    PYTHONUNBUFFERED: "1",
    PWD: opts.cwd,
  });
  if (opts.cols !== undefined) env.COLUMNS = String(opts.cols);
  return env;
}
