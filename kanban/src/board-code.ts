// The board plugins as the daemon part reads them from the working server's folder (src/daemon/folder.ts) and gives
// them to the web part: each file as JavaScript (Node.js took its types out), with where it imports the folder's other
// files. Both parts run a plugin by linking its files into modules of URLs of their own (data: in Node.js, blob: in
// the browser), each import pointing at the URL of the file it names. No React and no Node.js here, for both parts.

/** A file of a board plugin, as JavaScript. */
export interface ModuleCode {
  code: string;
  /** Where it imports the folder's other files: the specifier between the quotes, and the file's path in the folder. */
  imports: { start: number; end: number; path: string }[];
}

export interface PluginCode {
  /** Its folder's name. */
  name: string;
  /** Of its files: the same for the same code. */
  hash: string;
  /** Its index.ts and the files it imports, by their path in the folder ("example/index.ts", "types.ts"). */
  modules: Record<string, ModuleCode>;
}

/** Why a board plugin cannot be used, or the folder cannot be read. */
export interface PluginProblem {
  /** The plugin; none for the folder itself. */
  plugin?: string;
  /** The file, by its path in the folder, and the line in it. */
  file?: string;
  line?: number;
  error: string;
}

/** The board plugins in a working server's folder. */
export interface PluginSet {
  /** The folder. */
  dir: string;
  /** Changes whenever the plugins or their problems change. */
  version: string;
  /** Every folder with an index.ts, those that cannot be used too. */
  names: string[];
  /** The ones that can be used. */
  plugins: PluginCode[];
  problems: PluginProblem[];
}

/**
 * Links the plugin's files into modules: each file gets the URL that `url` makes of its code, once its imports point at
 * the URLs of the files they name, so that importing `entry` runs the plugin. `files` gives the file of each URL, for
 * the messages. Throws when the files import each other in a loop.
 */
export function linkPlugin(plugin: PluginCode, url: (code: string, file: string) => string): { entry: string; files: Map<string, string> } {
  const urls = new Map<string, string>();
  const files = new Map<string, string>();
  const link = (file: string, through: string[]): string => {
    const done = urls.get(file);
    if (done !== undefined) return done;
    if (through.includes(file)) throw new Error(`import が輪になっています：${[...through, file].join(" → ")}`);
    const m = plugin.modules[file];
    if (!m) throw new Error(`${file} がありません。`);
    let code = m.code;
    for (const i of [...m.imports].sort((a, b) => b.start - a.start)) code = code.slice(0, i.start) + link(i.path, [...through, file]) + code.slice(i.end);
    const u = url(code, file);
    urls.set(file, u);
    files.set(u, file);
    return u;
  };
  return { entry: link(`${plugin.name}/index.ts`, []), files };
}

/**
 * What went wrong in a linked plugin, with the files named rather than their URLs: the message, and the file and the
 * line where it happened when the error's stack names one of them.
 */
export function problemOf(e: unknown, files: ReadonlyMap<string, string>): { error: string; file?: string; line?: number } {
  const named = (s: string) => [...files].reduce((out, [u, f]) => out.replaceAll(u, f), s);
  const error = named(e instanceof Error ? e.message : String(e));
  const stack = e instanceof Error && typeof e.stack === "string" ? named(e.stack) : "";
  const names = [...files.values()];
  for (const m of stack.matchAll(/([^\s()]+\.ts):(\d+)(?::\d+)?/g)) {
    const file = names.find((f) => m[1] === f || m[1]?.endsWith(`/${f}`));
    if (file) return { error, file, line: Number(m[2]) };
  }
  return { error };
}
