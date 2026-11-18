// Runs the tests, as `npm test` does, and shows the share of the lines, branches and functions they run, per top folder
// (a plugin, or scripts). Run it with `npm run test:coverage`; .github/workflows/release.yml runs it in place of
// `npm test` and puts the table in the job's summary. The numbers are not a goal and never fail it: it fails only when
// a test fails (as in Gasho, 4rtofl/Gasho#126).
//
// Node counts only the files the tests load, and every line of them, blank lines and comments too. Here, a .ts file no
// test loads counts too, all its lines as not run, unless it holds only types; its branches and functions are left out,
// as Node counts them only by running the file. Not counted: the .tsx of the screens (Node cannot load JSX), .d.ts, and
// the tests themselves: what is under test/ and *.test.ts (README.md, "ビルドする").
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import os from "node:os";
import path from "node:path";

export interface Count {
  hit: number;
  found: number;
}

/** What the tests ran of the files of a folder. */
export interface Coverage {
  lines: Count;
  branches: Count;
  functions: Count;
  /** The .ts files no test loads, and their lines (fileLines). */
  unloaded: { file: string; lines: number }[];
}

const empty = (): Coverage => ({ lines: { hit: 0, found: 0 }, branches: { hit: 0, found: 0 }, functions: { hit: 0, found: 0 }, unloaded: [] });

/** The totals of a file in an lcov report, as Node's lcov reporter writes them. */
const LCOV_TOTALS: Record<string, [Exclude<keyof Coverage, "unloaded">, keyof Count]> = {
  LF: ["lines", "found"],
  LH: ["lines", "hit"],
  BRF: ["branches", "found"],
  BRH: ["branches", "hit"],
  FNF: ["functions", "found"],
  FNH: ["functions", "hit"],
};

/** Each file of an lcov report, by its path from the folder the tests ran in. */
function readLcov(text: string): Map<string, Coverage> {
  const files = new Map<string, Coverage>();
  let file: Coverage | undefined;
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":");
    const key = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const total = LCOV_TOTALS[key];
    if (key === "SF") files.set(value, (file = empty()));
    else if (file && total) file[total[0]][total[1]] = Number(value);
  }
  return files;
}

/** The lines of a file as Node's lcov counts them for a file the tests load: all of them, blank lines and comments too. */
const fileLines = (source: string) => source.split(/(?<=\n)/).length;

/** The lines of a .ts file that hold code once its types are stripped, leaving out blank lines and comments: none when it holds only types. */
function codeLines(source: string): number {
  let code: string;
  try {
    code = stripTypeScriptTypes(source);
  } catch {
    // An enum or a namespace has code of its own, which only "transform" turns into JavaScript; it moves the lines.
    code = stripTypeScriptTypes(source, { mode: "transform" });
  }
  return code.split("\n").filter((line) => {
    const s = line.trim();
    return s !== "" && !/^(\/\/|\/\*|\*)/.test(s);
  }).length;
}

/**
 * The coverage of each top folder: Node's counts (lcov) for the files the tests loaded, and for each of `sources` they
 * did not that holds code, all its lines (fileLines), as not run.
 */
export function byFolder(lcov: string, sources: string[], read: (file: string) => string): Map<string, Coverage> {
  const folders = new Map<string, Coverage>();
  const folderOf = (file: string) => {
    const name = file.split("/")[0]!;
    let folder = folders.get(name);
    if (!folder) folders.set(name, (folder = empty()));
    return folder;
  };
  const loaded = readLcov(lcov);
  for (const [file, c] of loaded) add(folderOf(file), c);
  for (const file of sources) {
    if (loaded.has(file)) continue;
    const source = read(file);
    if (codeLines(source) === 0) continue;
    const lines = fileLines(source);
    const folder = folderOf(file);
    folder.lines.found += lines;
    folder.unloaded.push({ file, lines });
  }
  return folders;
}

function add(to: Coverage, c: Coverage): void {
  for (const key of ["lines", "branches", "functions"] as const) {
    to[key].hit += c[key].hit;
    to[key].found += c[key].found;
  }
  to.unloaded.push(...c.unloaded);
}

const percent = (c: Count) => (c.found === 0 ? "—" : `${((c.hit / c.found) * 100).toFixed(1)}%（${c.hit} / ${c.found}）`);

/** The table in Markdown: a row for each of `names` (with "—" for a folder without code) and one for all of them. */
function summary(folders: Map<string, Coverage>, names: string[], tsx: number): string {
  const all = empty();
  for (const c of folders.values()) add(all, c);
  const row = (name: string, c: Coverage) => `| ${name} | ${percent(c.lines)} | ${percent(c.branches)} | ${percent(c.functions)} | ${c.unloaded.length} |`;
  return [
    "## テストのカバレッジ",
    "",
    "| フォルダー | 行 | 分岐 | 関数 | テストが読み込まない .ts |",
    "|---|--:|--:|--:|--:|",
    ...names.map((name) => row(`\`${name}\``, folders.get(name) ?? empty())),
    row("全体", all),
    "",
    `テストが読み込まない \`.ts\` は、Node が読み込んだファイルを数えるのと同じく、空行とコメントもふくめたすべての行を通っていない行として数え、分岐と関数には入れない。画面の \`.tsx\`（${tsx} ファイル）は、Node が読み込めないので数えない。数字で CI を落とさない。`,
    "",
    `<details><summary>テストが読み込まない .ts（${all.unloaded.length} ファイル）</summary>`,
    "",
    ...all.unloaded.map((u) => `- \`${u.file}\`（${u.lines} 行）`),
    "",
    "</details>",
    "",
  ].join("\n");
}

function main(): void {
  const root = path.resolve(import.meta.dirname, "..");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gasho-plugins-coverage-"));
  const lcovFile = path.join(tmp, "lcov.info");
  // The files `npm test` runs, taken from it so that the two never run different tests.
  const rootPackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: { test: string }; workspaces: string[] };
  const testPatterns = [...rootPackage.scripts.test.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  if (testPatterns.length === 0) throw new Error("no test file pattern found in the test script of package.json");
  try {
    const tests = spawnSync(
      process.execPath,
      [
        "--test",
        "--disable-warning=ExperimentalWarning",
        "--experimental-test-coverage",
        "--test-coverage-exclude=**/test/**",
        "--test-coverage-exclude=**/node_modules/**",
        // An exclude given here replaces Node's default one of the test files; those outside test/ are in kanban/plugins/*/.
        "--test-coverage-exclude=**/*.test.ts",
        "--test-reporter=spec",
        "--test-reporter-destination=stdout",
        "--test-reporter=lcov",
        `--test-reporter-destination=${lcovFile}`,
        ...testPatterns,
      ],
      { cwd: root, stdio: "inherit" },
    );
    if (fs.existsSync(lcovFile)) {
      // The files git has or would add: not each person's kanban board plugins, which .gitignore leaves out.
      const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
        .split("\n")
        .filter((f) => !f.split("/").includes("test") && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx") && fs.existsSync(path.join(root, f)));
      const sources = files.filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));
      const folders = byFolder(fs.readFileSync(lcovFile, "utf8"), sources, (f) => fs.readFileSync(path.join(root, f), "utf8"));
      const names = [...new Set([...rootPackage.workspaces, ...folders.keys()])].sort();
      const text = summary(folders, names, files.filter((f) => f.endsWith(".tsx")).length);
      console.log(`\n${text}`);
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
    }
    process.exitCode = tests.status ?? 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.main) main();
