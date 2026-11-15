// A pull request's files in the folders that hold them, for the tab of files. A folder that holds only one folder is
// one row with it ("src/web/item"), as on GitHub, so that deep paths do not push the files far to the right.
import type { GitHubFile } from "../../types.ts";

export interface FileFolder {
  /** As shown: one folder, or a chain of them joined with "/". The top of the repository has none. */
  name: string;
  /** From the top of the repository: what a folded folder is known by. */
  path: string;
  folders: FileFolder[];
  files: GitHubFile[];
  /** Of the files in it and in its folders. */
  count: number;
  additions: number;
  deletions: number;
}

export const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
export const folderOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")));

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const empty = (name: string, path: string): FileFolder => ({ name, path, folders: [], files: [], count: 0, additions: 0, deletions: 0 });

/** The top of the repository, its folders before its files, each sorted by name. */
export function fileTree(files: GitHubFile[]): FileFolder {
  const top = empty("", "");
  const folders = new Map<string, FileFolder>([["", top]]);
  const folderAt = (path: string): FileFolder => {
    let d = folders.get(path);
    if (!d) {
      d = empty(baseName(path), path);
      folders.set(path, d);
      folderAt(folderOf(path)).folders.push(d);
    }
    return d;
  };
  for (const f of files) folderAt(folderOf(f.path)).files.push(f);
  return settle(top, true);
}

/** Joins a folder with the one folder it holds, sorts, and adds up. */
function settle(d: FileFolder, top: boolean): FileFolder {
  let at = d;
  for (let only = at.folders[0]; !top && at.files.length === 0 && at.folders.length === 1 && only; only = at.folders[0]) {
    at = { ...only, name: `${at.name}/${only.name}` };
  }
  const folders = at.folders.map((c) => settle(c, false)).sort((a, b) => byName(a.name, b.name));
  const files = [...at.files].sort((a, b) => byName(baseName(a.path), baseName(b.path)));
  const add = (k: "count" | "additions" | "deletions") => folders.reduce((n, c) => n + c[k], 0);
  return {
    ...at,
    folders,
    files,
    count: files.length + add("count"),
    additions: files.reduce((n, f) => n + f.additions, 0) + add("additions"),
    deletions: files.reduce((n, f) => n + f.deletions, 0) + add("deletions"),
  };
}

/** Every folder below the top, for folding all of them. */
export function folderPaths(d: FileFolder): string[] {
  return d.folders.flatMap((c) => [c.path, ...folderPaths(c)]);
}
