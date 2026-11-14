// How the panel writes times, folders and the operations log's summary. Pure, and imports nothing.

/** "0.1秒未満", "0.3秒", "12秒", "1分5秒", "1時間2分". A time before the start (the clocks differ) is 0. */
export function duration(ms: number): string {
  const t = Math.max(0, Math.floor(ms));
  if (t < 100) return "0.1秒未満";
  if (t < 10_000) return `${(Math.floor(t / 100) / 10).toFixed(1)}秒`;
  const s = Math.floor(t / 1000);
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分${s % 60}秒`;
  return `${Math.floor(m / 60)}時間${m % 60}分`;
}

const basename = (dir: string): string => dir.replace(/\/+$/, "").split("/").pop() || "/";

const under = (dir: string, root: string): boolean => {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return dir === root || dir.startsWith(prefix);
};

/** Whether `dir` is the session's folder or inside it. */
export const insideFolder = (dir: string, folder: string): boolean => under(dir, folder);

/**
 * A folder as the panel shows it: from the session folder's name when it is in it ("Gasho/apps"), else with "~" for
 * the home folder, else as it is.
 */
export function folderLabel(dir: string, folder: string, home?: string): string {
  if (dir === folder) return basename(folder);
  if (under(dir, folder)) return `${basename(folder)}/${dir.slice(folder.replace(/\/+$/, "").length + 1)}`;
  if (home && home !== "/" && under(dir, home)) return `~${dir.slice(home.replace(/\/+$/, "").length)}`;
  return dir;
}

/** What the operations log keeps of a command: "$ " and its first line, with "…" when more lines follow. */
export function commandSummary(command: string): string {
  const lines = command.trim().split("\n");
  return `$ ${lines[0]?.trim() ?? ""}${lines.length > 1 ? " …" : ""}`;
}

/** The commands for ↑ and ↓: oldest first, without one repeated right after itself. */
export function commandHistory(commands: string[]): string[] {
  const out: string[] = [];
  for (const c of commands) if (c !== out[out.length - 1]) out.push(c);
  return out;
}
