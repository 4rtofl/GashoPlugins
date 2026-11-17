// Fakes for testing the daemon parts of the plugins (and scripts that run gh) without gh, git or Gasho:
//
// - fakeCommands: gh and git (any command) answered by a function of the test, with every command it was asked.
// - fakeContext: a DaemonContext whose exec and github run those, with a session, settings, folders and a dataDir.
// - loadDaemon: a plugin's src/daemon/index.ts, called as gasho-daemon calls it (Gasho's apps/daemon/src/plugin-host.ts):
//   params and results go through JSON, a PluginError's message reaches the person and any other error shows as
//   「処理に失敗しました。…」, and ctx.github.write fails outside a method whose kind is "write". It checks that the
//   daemon part defines the methods its gasho-plugin.json lists, and expands Vite's import.meta.glob (eager only, and ?raw).
//
//   import { execError, fakeContext, loadDaemon } from "../../test/daemon.ts";
//
//   const daemon = await loadDaemon("git");
//   const { ctx, calls } = fakeContext({
//     session: { cwd: "/w/app", github: { owner: "o", name: "app" } },
//     run: ({ command, args }) => (command === "gh" && args[0] === "issue" ? "[]" : execError({ stderr: "HTTP 404" })),
//   });
//   const list = await daemon.call("list", { kind: "issues" }, ctx);
//   assert.deepEqual(list, { repo: { owner: "o", name: "app" }, kind: "issues", items: [], truncated: false });
//   assert.deepEqual(calls[0]?.args.slice(0, 2), ["issue", "list"]);
//   await assert.rejects(daemon.call("list", { kind: "x" }, ctx), /一覧の種類/);
//
// A daemon part is loaded once per test file (node --test runs each file in a process of its own), so what its
// modules keep (caches, what `start` made) stays between calls; load it with loadDaemon, not a static import, so that
// its import.meta.glob is expanded.
import fs from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  DaemonContext,
  DaemonGitHub,
  DaemonPluginDefinition,
  DaemonSession,
  DaemonStartContext,
  ExecError,
  ExecResult,
  GitHubRepo,
} from "@gasho/plugin-sdk/daemon";

const ROOT = path.resolve(import.meta.dirname, "..");

/** What gasho-daemon shows for an error that is not a PluginError (Gasho's apps/daemon/src/plugins.ts). */
export const FAILED = "処理に失敗しました。詳しくは、working server の gasho-daemon のログを見てください。";
/** What ctx.github.write fails with outside a write method (Gasho's apps/daemon/src/plugins.ts). */
export const READ_ONLY = "GitHub を変える操作（ctx.github.write）は、gasho-plugin.json の kind が write のメソッドの中でだけできます。";

/** A command the code under test ran: with ctx.exec, or gh with ctx.github.read or .write (or a script's own runner). */
export interface Ran {
  command: string;
  args: string[];
  via: "exec" | "github.read" | "github.write";
  /** Its ExecOptions, GitHubReadOptions or GitHubWriteOptions. */
  options?: object;
}

/** A fake command's answer: its stdout, its stdout and stderr, or the error of a command that failed (execError). */
export type Answer = string | Partial<ExecResult> | Error;

/** Answers each command; may also throw. */
export type Run = (ran: Ran) => Answer | Promise<Answer>;

/** What exec and ctx.github throw for a command that failed: `code` is 1 unless given. */
export function execError(o: { code?: number | string; stdout?: string; stderr?: string; killed?: boolean } = {}): ExecError {
  return Object.assign(new Error(`Command failed (${o.killed ? "stopped" : `exit code ${o.code ?? 1}`})\n${o.stderr ?? ""}`), {
    code: o.code ?? 1,
    killed: o.killed ?? false,
    stdout: o.stdout ?? "",
    stderr: o.stderr ?? "",
  });
}

const unexpected: Run = ({ command, args }) => {
  throw new Error(`the test has no answer for: ${command} ${args.join(" ")}`);
};

function result(a: Answer): ExecResult {
  if (a instanceof Error) throw a;
  return typeof a === "string" ? { stdout: a, stderr: "" } : { stdout: a.stdout ?? "", stderr: a.stderr ?? "" };
}

/** Commands answered by `run`, with every command asked in `calls`. `runSync` is for code that runs them synchronously. */
export function fakeCommands(run: Run = unexpected) {
  const calls: Ran[] = [];
  return {
    calls,
    async run(ran: Ran): Promise<ExecResult> {
      calls.push(ran);
      return result(await run(ran));
    },
    runSync(ran: Ran): ExecResult {
      calls.push(ran);
      const a = run(ran);
      if (a instanceof Promise) throw new Error(`answer ${ran.command} ${ran.args.join(" ")} without a promise: it runs synchronously`);
      return result(a);
    },
  };
}

/** The session a call is about, as gasho-daemon tells it (repos: those inside its folder, at paths relative to it). */
export interface FakeSession {
  cwd: string;
  sessionId?: string;
  name?: string;
  managed?: boolean;
  github?: GitHubRepo;
  gitBranch?: string;
  repos?: { path: string; github?: GitHubRepo; branch?: string }[];
}

export interface FakeContextOptions {
  /** Answers ctx.exec, and ctx.github as the command "gh". Without it, any command fails the test. */
  run?: Run;
  session?: FakeSession;
  settings?: Record<string, unknown>;
  folders?: string[];
  /** A new folder in the system's temporary folder when not given. */
  dataDir?: string;
  machine?: { id: string; name: string };
}

export interface FakeContext {
  ctx: DaemonContext;
  /** Every command run through ctx.exec and ctx.github, in order. */
  calls: Ran[];
  /** What ctx.emit sent, its data as JSON. */
  events: { topic: string; data: unknown; retain: boolean }[];
  /** What ctx.log wrote (not printed). */
  logs: unknown[][];
}

/** An error whose message gasho-daemon shows to the person, as a PluginError. */
const userError = (message: string) => Object.assign(new Error(message), { gashoPluginError: true });

/** A session with repo(), as Gasho's plugin-host.ts makes it. */
function sessionOf(s: FakeSession): DaemonSession {
  const repos = (s.repos ?? []).map((r) => ({ path: r.path, dir: path.join(s.cwd, r.path), github: r.github, branch: r.branch }));
  return {
    sessionId: s.sessionId ?? "s1",
    cwd: s.cwd,
    name: s.name,
    managed: s.managed ?? true,
    github: s.github,
    gitBranch: s.gitBranch,
    repos,
    repo(p) {
      if (p === undefined || p === "") return { dir: s.cwd, github: s.github, branch: s.gitBranch };
      const r = repos.find((x) => x.path === p);
      if (!r) throw userError("このリポジトリは見つかりません。");
      return { dir: r.dir, github: r.github, branch: r.branch };
    },
  };
}

const json = (v: unknown): unknown => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function fakeContext(o: FakeContextOptions = {}): FakeContext {
  const commands = fakeCommands(o.run);
  const events: FakeContext["events"] = [];
  const logs: unknown[][] = [];
  const ctx: DaemonContext = {
    machine: o.machine ?? { id: "m1", name: "mac" },
    ...(o.session ? { session: sessionOf(o.session) } : {}),
    settings: o.settings ?? {},
    folders: () => [...(o.folders ?? [])],
    dataDir: o.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "gasho-plugin-data-")),
    signal: new AbortController().signal,
    exec: (command, args, options) => commands.run({ command, args, via: "exec", options }),
    github: {
      read: (args, options) => commands.run({ command: "gh", args, via: "github.read", options }),
      write: (args, options) => commands.run({ command: "gh", args, via: "github.write", options }),
    },
    emit: (topic, data, options) => void events.push({ topic, data: json(data), retain: options?.retain === true }),
    log: (...args) => void logs.push(args),
  };
  return { ctx, calls: commands.calls, events, logs };
}

/** How a call failed, as the person sees it: a PluginError's message (`user`), else FAILED. `cause`: what was thrown. */
export class CallError extends Error {
  readonly user: boolean;
  constructor(thrown: unknown) {
    const user = (thrown as { gashoPluginError?: unknown } | null)?.gashoPluginError === true;
    super(user ? (thrown as Error).message : FAILED, { cause: thrown });
    this.name = "CallError";
    this.user = user;
  }
}

export interface Daemon {
  definition: DaemonPluginDefinition;
  /** The kind of each method, from gasho-plugin.json. */
  kinds: Record<string, "read" | "write">;
  /** Calls a method as gasho-daemon does; rejects with a CallError. */
  call(method: string, params: unknown, ctx: DaemonContext): Promise<unknown>;
  /** Runs `start` with the context without a session or a call, as gasho-daemon does when the process starts. */
  start(ctx: DaemonContext): Promise<void>;
  stop(): Promise<void>;
}

/** ctx.github with write refused, as gasho-daemon refuses a write outside a write method. */
const readOnly = (github: DaemonGitHub): DaemonGitHub => ({ read: github.read, write: async () => Promise.reject(userError(READ_ONLY)) });

/**
 * The daemon part (src/daemon/index.ts) of the plugin in `folder`: its id, or a path from the root of the repository.
 * Throws when it does not define the methods its gasho-plugin.json lists.
 */
export async function loadDaemon(folder: string): Promise<Daemon> {
  const dir = path.resolve(ROOT, folder);
  const id = path.basename(dir);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "gasho-plugin.json"), "utf8")) as { methods?: Record<string, { kind?: unknown }> };
  const mod = (await import(pathToFileURL(path.join(dir, "src", "daemon", "index.ts")).href)) as { default?: DaemonPluginDefinition };
  const definition = mod.default;
  if (!definition || typeof definition.methods !== "object") throw new Error(`${id}: src/daemon/index.ts does not export defineDaemonPlugin({ methods }) as default`);
  const kinds: Record<string, "read" | "write"> = {};
  for (const [name, m] of Object.entries(manifest.methods ?? {})) kinds[name] = m.kind === "write" ? "write" : "read";
  const listed = Object.keys(kinds).sort().join(", ");
  const defined = Object.keys(definition.methods).sort().join(", ");
  if (listed !== defined) throw new Error(`${id}: gasho-plugin.json lists the methods [${listed}], its daemon part defines [${defined}]`);
  const base = (ctx: DaemonContext): DaemonStartContext => {
    const { session: _, signal: __, ...rest } = ctx;
    return { ...rest, github: readOnly(ctx.github) };
  };
  return {
    definition,
    kinds,
    async call(method, params, ctx) {
      const kind = kinds[method];
      if (kind === undefined) throw new Error(`${id}: gasho-plugin.json lists no method ${method}`);
      const call: DaemonContext = { ...ctx, signal: new AbortController().signal, github: kind === "write" ? ctx.github : readOnly(ctx.github) };
      try {
        return json(await definition.methods[method]!(json(params), call));
      } catch (e) {
        throw new CallError(e);
      }
    },
    async start(ctx) {
      await definition.start?.(base(ctx));
    },
    async stop() {
      await definition.stop?.();
    },
  };
}

// Vite's import.meta.glob(patterns, { eager: true }), which gasho-plugin build expands, for Node: the files it matches
// become imports at the end of the module (so that its lines keep their numbers), and the call an object of them, keyed
// as Vite keys them ("./ops/add.ts", "../../plugins/example/index.ts"). With { query: "?raw", import: "default", eager: true }
// the object holds the text of each file. `patterns` is one string or an array of them.
const GLOB = /import\.meta\.glob(?:<[^()]*?>)?\(\s*(\[[^\]]*\]|(["'])[^"']+\2)\s*,\s*\{([^{}]*)\}\s*\)/g;
const RAW = /^\s*(?:eager:\s*true|query:\s*"\?raw"|import:\s*"default")\s*$/;

function expandGlobs(source: string, file: string): string {
  const imports: string[] = [];
  const out = source.replace(GLOB, (call, patterns: string, _q: string, options: string) => {
    const given = options.split(",").filter((o) => o.trim());
    const raw = given.some((o) => /query/.test(o));
    const known = given.every((o) => RAW.test(o)) && given.some((o) => /eager/.test(o)) && given.some((o) => /import/.test(o)) === raw;
    if (!known) return call;
    const keys = new Set<string>();
    for (const m of patterns.matchAll(/(["'])([^"']+)\1/g)) {
      for (const f of fs.globSync(m[2]!, { cwd: path.dirname(file) })) {
        if (fs.statSync(path.resolve(path.dirname(file), f)).isFile()) keys.add(f.startsWith("../") ? f : `./${f}`);
      }
    }
    const entries = [...keys].sort().map((key) => {
      if (raw) return `${JSON.stringify(key)}: ${JSON.stringify(fs.readFileSync(path.resolve(path.dirname(file), key), "utf8"))}`;
      const name = `__gashoGlob${imports.length}`;
      imports.push(`import * as ${name} from ${JSON.stringify(key)};`);
      return `${JSON.stringify(key)}: ${name}`;
    });
    return `({ ${entries.join(", ")} })${"\n".repeat(call.split("\n").length - 1)}`;
  });
  if (/import\.meta\.glob\s*[<(]/.test(out)) {
    throw new Error(`${file}: test/daemon.ts expands only import.meta.glob("<pattern>" or ["<pattern>", …], { eager: true } or { query: "?raw", import: "default", eager: true })`);
  }
  return `${out}\n${imports.join("\n")}\n`;
}

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.startsWith("file:") || url.includes("/node_modules/") || loaded.source == null) return loaded;
    const source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source as Uint8Array).toString("utf8");
    if (!source.includes("import.meta.glob")) return loaded;
    return { ...loaded, source: expandGlobs(source, fileURLToPath(url)) };
  },
});
