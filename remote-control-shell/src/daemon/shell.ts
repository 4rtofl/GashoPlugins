// How a command is started (README.md「コマンドの起動」): which shell, with which switches and environment, and the short
// script that runs the command with `eval` and, as the shell ends, writes down the folder it ended in.
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
 * What the shell runs: `<shell> -c SCRIPT gasho-shell <cwd file> <command>`. The command runs as written, with eval,
 * so that it may span lines; however the shell then ends (also by `exit` in the command), the EXIT trap writes the
 * folder it is in to <cwd file>, for the next command (README.md「作業フォルダー」). The trap keeps the command's exit
 * status.
 */
export const SCRIPT = [
  "__gasho_cwd_file=$1",
  "__gasho_command=$2",
  "shift 2",
  "trap 'pwd > \"$__gasho_cwd_file\" 2>/dev/null' EXIT",
  'eval "$__gasho_command"',
].join("\n");

export function shellArgs(startup: Startup, cwdFile: string, command: string): string[] {
  return [...startupArgs(startup), "-c", SCRIPT, "gasho-shell", cwdFile, command];
}

/** What a command inherits from gasho-daemon: what gasho-daemon gives the terminals of sessions (its cleanEnv). */
const INHERITED = ["HOME", "USER", "LOGNAME", "PATH", "SHELL", "LANG", "LC_ALL", "XDG_RUNTIME_DIR", "TMPDIR"];

/**
 * The environment of a command: the variables above, and what lets it print colors, keeps git and gh from paging or
 * waiting for an answer, and makes a command that opens an editor fail at once (there is no terminal to type in).
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
    PWD: opts.cwd,
  });
  if (opts.cols !== undefined) env.COLUMNS = String(opts.cols);
  return env;
}
