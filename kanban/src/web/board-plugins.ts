// A working server's board plugins, run in this browser for `state` and `headings`: the daemon part gives their code
// (PluginSet), and each plugin's files are linked into modules of blob: URLs and imported, once for each version of
// it (its hash). A module stays in the page once imported, so a plugin saved many times keeps its old versions in
// memory until the page is loaded again. Not in src/cards.ts, which the tests run without a browser.
import { useEffect, useState } from "react";
import { linkPlugin, problemOf, type PluginCode, type PluginProblem, type PluginSet } from "../board-code.ts";
import type { BoardPlugins } from "../cards.ts";

type Loaded = { state?: unknown; headings?: unknown } | PluginProblem;

const loaded = new Map<string, Promise<Loaded>>();

function load(plugin: PluginCode): Promise<Loaded> {
  let p = loaded.get(plugin.hash);
  if (p) return p;
  p = (async (): Promise<Loaded> => {
    const urls: string[] = [];
    let files = new Map<string, string>();
    try {
      const linked = linkPlugin(plugin, (code) => {
        const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
        urls.push(url);
        return url;
      });
      files = linked.files;
      const mod = (await import(/* @vite-ignore */ linked.entry)) as { state?: unknown; headings?: unknown };
      return { state: mod.state, headings: mod.headings };
    } catch (e) {
      const p = problemOf(e, files);
      return { plugin: plugin.name, file: `${plugin.name}/index.ts`, ...p, error: `ブラウザーで読み込めません：${p.error}` };
    } finally {
      // The modules are in the page once imported.
      for (const url of urls) URL.revokeObjectURL(url);
    }
  })();
  loaded.set(plugin.hash, p);
  return p;
}

/**
 * The board plugins of `set` as this browser runs them, with the problems of those that cannot be used (the daemon
 * part's, and this browser's); the ones before while a new `set` loads, and undefined before the first.
 */
export function useBoardPlugins(set: PluginSet | undefined): { plugins: BoardPlugins; problems: PluginProblem[] } | undefined {
  const [out, setOut] = useState<{ version: string; plugins: BoardPlugins; problems: PluginProblem[] }>();
  useEffect(() => {
    if (!set || set.version === out?.version) return;
    let live = true;
    void Promise.all(set.plugins.map(async (p) => [p.name, await load(p)] as const)).then((list) => {
      if (!live) return;
      const problems = [...set.problems, ...list.flatMap(([, l]) => ("error" in l ? [l] : []))];
      const plugins = new Map<string, { state?: unknown; headings?: unknown; error?: string }>(list);
      for (const p of problems) if (p.plugin !== undefined) plugins.set(p.plugin, { error: p.error });
      setOut({ version: set.version, plugins, problems });
    });
    return () => {
      live = false;
    };
  }, [set?.version]);
  return out && { plugins: out.plugins, problems: out.problems };
}
