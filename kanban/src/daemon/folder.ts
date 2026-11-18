// The board plugins' folder of the working server (<the kanban's dataDir>/plugins/), which updating the kanban keeps.
// Whenever the kanban starts, it writes there again its types, its helpers and the guide for writing a plugin, and the
// sample when its folder is not there. It reads every <name>/index.ts there with the files it imports, when it starts
// and whenever a file there is saved: Node.js takes their types out, and es-module-lexer finds their imports. It runs
// them here for `fetch`, and gives the web part the same code for `state` and `headings` (src/board-code.ts).
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { init, parse } from "es-module-lexer/js";
import type { Fetch } from "../../plugins/types.ts";
import { linkPlugin, problemOf, type ModuleCode, type PluginCode, type PluginProblem, type PluginSet } from "../board-code.ts";

/** Files saved one after another (an editor, git checkout) are read once, this long after the last of them. */
const SETTLE_MS = 300;
/** Folders that are not plugins, and whose changes are not read: what npm installs, and the cards written out. */
const SKIP = new Set(["node_modules", "cards"]);

export interface FolderDeps {
  dir: string;
  /** What the kanban writes again whenever it starts (types.ts, the guide), by path in the folder. */
  placed: Readonly<Record<string, string>>;
  /** The sample, by path in the folder: written only when its folder is not there. */
  sample: Readonly<Record<string, string>>;
  log: (...args: unknown[]) => void;
}

const hashOf = (v: unknown): string => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const lineAt = (code: string, at: number): number => code.slice(0, at).split("\n").length;
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Where Node.js could not take a file's types out: the line, from the first line of its stack ("<file>:<line>"). */
function stripProblem(e: unknown, file: string): Omit<PluginProblem, "plugin"> {
  const line = typeof (e as { stack?: unknown } | null)?.stack === "string" ? /^.*:(\d+)\n/.exec((e as Error).stack ?? "")?.[1] : undefined;
  const unsupported = (e as { code?: unknown } | null)?.code === "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX";
  return {
    file,
    ...(line ? { line: Number(line) } : {}),
    error: unsupported ? `型を取り除くだけでは動かない書き方です（enum、namespace などは使えません）：${message(e)}` : `TypeScript として読めません：${message(e)}`,
  };
}

/** A plugin's files from its index.ts, as JavaScript with their imports; or why it cannot be used. */
async function compile(dir: string, name: string): Promise<PluginCode | PluginProblem> {
  await init;
  const modules: Record<string, ModuleCode> = {};
  const visit = async (file: string): Promise<Omit<PluginProblem, "plugin"> | undefined> => {
    if (modules[file]) return undefined;
    let code: string;
    try {
      code = stripTypeScriptTypes(await fsp.readFile(path.join(dir, file), "utf8"), { sourceUrl: file });
    } catch (e) {
      return (e as { code?: unknown }).code === "ENOENT" ? { file, error: "ファイルがありません。" } : stripProblem(e, file);
    }
    const mod: ModuleCode = { code, imports: [] };
    modules[file] = mod;
    for (const i of parse(code, file)[0]) {
      // import.meta (dynamicStart -2 in the asm.js build) is not an import.
      if (i.type === "import-meta" || (i.type === "dynamic" && i.dynamicStart < 0)) continue;
      const at = { file, line: lineAt(code, i.start) };
      if (i.type === "dynamic") return { ...at, error: "import() は使えません。ファイルの先頭の import 文で読み込みます。" };
      const spec = i.specifier;
      if (!spec.startsWith("./") && !spec.startsWith("../")) return { ...at, error: `${spec} は import できません。import できるのは、この置き場の .ts のファイルだけです。` };
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      if (target.startsWith("../")) return { ...at, error: `${spec} は置き場の外です。` };
      if (!target.endsWith(".ts")) return { ...at, error: `${spec}：拡張子 .ts を付けて import します。` };
      if (!fs.existsSync(path.join(dir, target))) return { ...at, error: `${spec} がありません。` };
      mod.imports.push({ start: i.start, end: i.end, path: target });
      const problem = await visit(target);
      if (problem) return problem;
    }
    return undefined;
  };
  const problem = await visit(`${name}/index.ts`);
  if (problem) return { plugin: name, ...problem };
  return { name, hash: hashOf(Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))), modules };
}

/**
 * Runs a plugin in this process, as data: URL modules (Node.js keeps one module for each, so a file that did not change
 * is not run again); its `fetch`, or why it cannot be used.
 */
async function run(plugin: PluginCode): Promise<{ fetch?: Fetch } | PluginProblem> {
  const at = { plugin: plugin.name, file: `${plugin.name}/index.ts` };
  let linked: ReturnType<typeof linkPlugin>;
  try {
    linked = linkPlugin(plugin, (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  } catch (e) {
    return { ...at, error: message(e) };
  }
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ linked.entry)) as Record<string, unknown>;
  } catch (e) {
    const p = problemOf(e, linked.files);
    return { ...at, ...p, error: `読み込めません：${p.error}` };
  }
  if (typeof mod.state !== "function") return { ...at, error: "state を export していません。カードの列を決める state(card, fetched) が要ります。" };
  for (const k of ["fetch", "headings"]) if (mod[k] !== undefined && typeof mod[k] !== "function") return { ...at, error: `export した ${k} が関数ではありません。` };
  return typeof mod.fetch === "function" ? { fetch: mod.fetch as Fetch } : {};
}

export class BoardFolder {
  private deps: FolderDeps;
  private set: PluginSet;
  private fetchers = new Map<string, Fetch>();
  private loading: Promise<PluginSet> | undefined;
  private watcher: fs.FSWatcher | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(deps: FolderDeps) {
    this.deps = deps;
    this.set = { dir: deps.dir, version: "", names: [], plugins: [], problems: [] };
  }

  /** The plugins as last read. */
  current(): PluginSet {
    return this.set;
  }

  /** The `fetch` of the plugin `name`, when it can be used and has one. */
  fetcher(name: string): Fetch | undefined {
    return this.fetchers.get(name);
  }

  /**
   * Writes the kanban's files, reads the plugins, and reads them again whenever a file is saved; `onChange` gets them
   * when they changed, with the plugins whose code changed (or that came or went).
   */
  async start(onChange: (set: PluginSet, changed: ReadonlySet<string>) => void): Promise<PluginSet> {
    try {
      await this.prepare();
    } catch (e) {
      this.deps.log("kanban: could not write the board plugins' folder", e);
    }
    const set = await this.reload();
    if (this.stopped) return set;
    try {
      this.watcher = fs.watch(this.deps.dir, { recursive: true }, (_, file) => {
        const top = String(file ?? "").split(path.sep)[0] ?? "";
        if (SKIP.has(top) || top.startsWith(".")) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          const before = new Map(this.set.plugins.map((p) => [p.name, p.hash]));
          const version = this.set.version;
          void this.reload().then((next) => {
            if (this.stopped || next.version === version) return;
            const changed = new Set([...before.keys(), ...next.plugins.map((p) => p.name)].filter((n) => before.get(n) !== next.plugins.find((p) => p.name === n)?.hash));
            onChange(next, changed);
          });
        }, SETTLE_MS);
      });
      this.watcher.on("error", (e) => this.deps.log("kanban: stopped watching the board plugins' folder", e));
    } catch (e) {
      this.deps.log("kanban: could not watch the board plugins' folder", e);
    }
    return set;
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.watcher?.close();
  }

  /** Writes what the kanban writes again (when it changed), and the sample when its folder is not there. */
  async prepare(): Promise<void> {
    const write = async (file: string, text: string) => {
      const to = path.join(this.deps.dir, file);
      if ((await fsp.readFile(to, "utf8").catch(() => undefined)) === text) return;
      await fsp.mkdir(path.dirname(to), { recursive: true });
      await fsp.writeFile(to, text);
    };
    for (const [file, text] of Object.entries(this.deps.placed)) await write(file, text);
    const folders = new Set(Object.keys(this.deps.sample).map((f) => f.split("/")[0] ?? ""));
    for (const folder of folders) {
      if (fs.existsSync(path.join(this.deps.dir, folder))) continue;
      for (const [file, text] of Object.entries(this.deps.sample)) if (file.startsWith(`${folder}/`)) await write(file, text);
    }
  }

  /** Writes `value` (the cards of a repository) to cards/<name>.json, for check.ts; the file's path. */
  async writeCards(name: string, value: unknown): Promise<string> {
    const file = path.join(this.deps.dir, "cards", `${name}.json`);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
    return file;
  }

  /** Reads the plugins again, after the reading going on. */
  reload(): Promise<PluginSet> {
    const next = (this.loading ?? Promise.resolve(this.set)).then(() => this.read());
    this.loading = next.catch(() => this.set);
    return next;
  }

  private async read(): Promise<PluginSet> {
    const { dir } = this.deps;
    const problems: PluginProblem[] = [];
    let names: string[] = [];
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      names = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP.has(e.name) && fs.existsSync(path.join(dir, e.name, "index.ts")))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
    } catch (e) {
      problems.push({ error: `カンバン用のプラグインの置き場を読めません：${message(e)}` });
    }
    const plugins: PluginCode[] = [];
    const fetchers = new Map<string, Fetch>();
    for (const name of names) {
      const code = await compile(dir, name).catch((e: unknown): PluginProblem => ({ plugin: name, file: `${name}/index.ts`, error: `読み込めません：${message(e)}` }));
      if (!("hash" in code)) {
        problems.push(code);
        continue;
      }
      const ran = await run(code);
      if ("error" in ran) {
        problems.push(ran);
        continue;
      }
      plugins.push(code);
      if (ran.fetch) fetchers.set(name, ran.fetch);
    }
    this.fetchers = fetchers;
    this.set = { dir, version: hashOf([names, plugins.map((p) => [p.name, p.hash]), problems]), names, plugins, problems };
    return this.set;
  }
}
