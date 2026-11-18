// Releases the plugins whose version has no release yet, and remakes the catalog that Gasho's plugins screen reads
// (Gasho's docs/plugins.md, P10). For each plugin (a workspace with a gasho-plugin.json), the release
// <id>-v<version> holds <id>-<version>.tgz, the files of its dist/ (and its LICENSE, when its folder has one). The
// release "catalog" holds catalog.json, the newest version of every plugin with the SHA-256 of its file, and the genres
// of genres.json, which the plugins screen lists the plugins by. Releases of older versions stay. Every plugin names one
// of the genres (checkPlugins, which scripts/check.ts runs on every pull request).
//
// A version released before keeps its file: its entry in the catalog is made from the gasho-plugin.json in that file,
// apart from its genre, which is the one gasho-plugin.json names now (a new genre needs no new version). When the
// plugin's folder has changed since that release, the change is not released until the version goes up, and it says so
// (a warning). A version older than one released already is an error, so that the catalog never goes back.
//
// .github/workflows/release.yml runs it on main after `npm run build`, with gh logged in (GH_TOKEN), and with --dry-run
// on pull requests; a run of a commit that main has moved on from releases nothing. Run it by hand with --dry-run to see
// what it would do; it then changes nothing.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { checkManifest, compareVersions, ID_RE, VERSION_RE } from "./manifest.ts";

export interface Manifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** The id of its genre, one of genres.json. */
  genre?: string;
  api: string;
  permissions?: string[];
  web?: { js: string; css?: string };
  daemon?: { js: string };
}

/** A manifest that passed checkPlugins: it names a genre of genres.json. */
export type CheckedManifest = Manifest & { genre: string };

/** A genre of genres.json. Gasho's plugins screen shows its name on the cards and lists the plugins by genre. */
export interface Genre {
  /** Like a plugin's id: 2-32 of a-z, 0-9 and "-", starting with a letter. */
  id: string;
  /** Its name on the plugins screen (up to 40 characters). */
  name: string;
  /** Which plugins it is for, for those who write one. */
  description: string;
}

/** One plugin of catalog.json (Gasho's CatalogPlugin). */
export interface CatalogEntry {
  id: string;
  name: string;
  version: string;
  description?: string;
  genre: string;
  api: string;
  permissions: string[];
  daemon: boolean;
  release: string;
  file: string;
  sha256: string;
  size: number;
}

export interface Catalog {
  repo: string;
  updatedAt: string;
  /** The genres in the order of genres.json, by id and name (Gasho's PluginGenre). */
  genres: { id: string; name: string }[];
  plugins: CatalogEntry[];
}

/** Something not right in a file (from the root of the repository), for scripts/check.ts to point at. */
export interface Problem {
  file: string;
  message: string;
}

/** A plugin whose folder changed since its version was released: the change is not released until the version goes up. */
export interface Unreleased {
  folder: string;
  id: string;
  version: string;
  /** The files that changed, from the root of the repository. */
  files: string[];
}

export const CATALOG_RELEASE = "catalog";
const CATALOG_FILE = "catalog.json";
/** A new catalog.json is uploaded under this name first, and takes the name catalog.json once it is there. */
const NEXT_CATALOG_FILE = "catalog-next.json";
export const releaseOf = (m: Manifest) => `${m.id}-v${m.version}`;
export const fileOf = (m: Manifest) => `${m.id}-${m.version}.tgz`;

/** The catalog's entry for a plugin's file. */
export function entryOf(m: CheckedManifest, file: { sha256: string; size: number }): CatalogEntry {
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    ...(m.description ? { description: m.description } : {}),
    genre: m.genre,
    api: m.api,
    permissions: m.permissions ?? [],
    daemon: Boolean(m.daemon),
    release: releaseOf(m),
    file: fileOf(m),
    sha256: file.sha256,
    size: file.size,
  };
}

/** Whether two catalogs list the same genres and plugins (when they were made aside). */
export function sameCatalog(a: Catalog | undefined, b: Catalog): boolean {
  return (
    a !== undefined &&
    a.repo === b.repo &&
    // A catalog made before genres has none.
    JSON.stringify(a.genres ?? []) === JSON.stringify(b.genres) &&
    JSON.stringify(a.plugins) === JSON.stringify(b.plugins)
  );
}

/** A workflow command's message, escaped (GitHub Actions' ::error and ::warning). */
const escape = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

/** A problem as an annotation of GitHub Actions on its file, titled with the file's name. */
export function annotation(level: "error" | "warning", p: Problem): string {
  const property = (s: string) => escape(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
  return `::${level} file=${property(p.file)},title=${property(path.posix.basename(p.file))}::${escape(p.message)}`;
}

/** The warning on a plugin changed since its release, on its gasho-plugin.json. */
export function unreleasedWarning(u: Unreleased): Problem {
  const shown = u.files.slice(0, 5).join(", ") + (u.files.length > 5 ? ` and ${u.files.length - 5} more` : "");
  return {
    file: `${u.folder}/gasho-plugin.json`,
    message: `${u.id} ${u.version} is released, and ${u.files.length} file(s) of ${u.folder} changed since (${shown}): they are not released until its version goes up`,
  };
}

/** The table of the plugins changed since their release, for the summary of the job (GITHUB_STEP_SUMMARY). */
export function unreleasedSummary(list: Unreleased[]): string {
  return [
    "## 公開していない変更",
    "",
    "次のプラグインは、公開した版のあとにフォルダーのファイルが変わっていますが、版が同じなので公開しません。公開するときは、`gasho-plugin.json` の `version` を上げます。",
    "",
    "| プラグイン | 公開済みの版 | 変わったファイル |",
    "|---|---|---|",
    ...list.map((u) => `| ${u.id} | ${u.version} | ${u.files.map((f) => `\`${f}\``).join("<br>")} |`),
    "",
  ].join("\n");
}

/** The genres of genres.json, in its order; throws when it is not right. */
export function readGenres(root: string): Genre[] {
  const raw = JSON.parse(fs.readFileSync(path.join(root, "genres.json"), "utf8")) as unknown;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("genres.json: list the genres in an array");
  const seen = new Set<string>();
  return raw.map((g: Partial<Genre> | null, i) => {
    const where = `genres.json: genre ${i + 1}${typeof g?.id === "string" ? ` (${g.id})` : ""}`;
    if (typeof g?.id !== "string" || !ID_RE.test(g.id)) throw new Error(`${where}: id must be 2-32 of a-z, 0-9 and -, starting with a letter`);
    if (seen.has(g.id)) throw new Error(`${where}: the id is there twice`);
    seen.add(g.id);
    if (typeof g.name !== "string" || !g.name.trim() || g.name.length > 40) throw new Error(`${where}: name must be 1-40 characters`);
    if (typeof g.description !== "string" || !g.description.trim()) throw new Error(`${where}: give a description of the plugins it is for`);
    return { id: g.id, name: g.name, description: g.description };
  });
}

/** Whether a plugin's package.json has the script that `npm run typecheck` runs in every workspace that has it. */
function hasTypecheck(root: string, folder: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, folder, "package.json"), "utf8")) as { scripts?: Record<string, unknown> };
    return typeof pkg.scripts?.typecheck === "string";
  } catch {
    return false;
  }
}

/**
 * Checks the plugins of the workspace, each folder of `workspaces` that has a gasho-plugin.json: by the rules of the Gasho
 * server (checkManifest), its id is the folder's name, and it names a genre of genres.json. A plugin with sources (web or
 * daemon) has a typecheck script. A folder with a gasho-plugin.json that is not a workspace is a problem too: it would be
 * neither built nor checked. Gives the plugins and every problem found.
 */
export function checkPlugins(root: string): { plugins: { folder: string; manifest: CheckedManifest }[]; problems: Problem[] } {
  let genres: Genre[];
  try {
    genres = readGenres(root);
  } catch (e) {
    return { plugins: [], problems: [{ file: "genres.json", message: e instanceof Error ? e.message.replace(/^genres\.json: /, "") : String(e) }] };
  }
  const ids = genres.map((g) => g.id);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { workspaces?: string[] };
  const workspaces = pkg.workspaces ?? [];
  const problems: Problem[] = [];
  const plugins = workspaces.flatMap((folder) => {
    const file = `${folder}/gasho-plugin.json`;
    if (!fs.existsSync(path.join(root, file))) return [];
    let manifest: Manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) as Manifest;
    } catch (e) {
      problems.push({ file, message: `it is not JSON (${e instanceof Error ? e.message : String(e)})` });
      return [];
    }
    const found = checkManifest(manifest, { folder, genres: ids });
    problems.push(...found.map((message) => ({ file, message })));
    if ((manifest.web !== undefined || manifest.daemon !== undefined) && !hasTypecheck(root, folder)) {
      problems.push({ file: `${folder}/package.json`, message: `it has no "typecheck" script, so npm run typecheck does not check the types of ${folder}` });
    }
    return found.length === 0 ? [{ folder, manifest: manifest as CheckedManifest }] : [];
  });
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules" || workspaces.includes(entry.name)) continue;
    if (fs.existsSync(path.join(root, entry.name, "gasho-plugin.json"))) {
      problems.push({ file: `${entry.name}/gasho-plugin.json`, message: `${entry.name} is not in the workspaces of package.json, so it is neither built nor released` });
    }
  }
  return { plugins, problems };
}

/** The plugins of the workspace (checkPlugins); throws when any of them is not right. */
export function readPlugins(root: string): { folder: string; manifest: CheckedManifest }[] {
  const { plugins, problems } = checkPlugins(root);
  if (problems.length > 0) throw new Error(problems.map((p) => `${p.file}: ${p.message}`).join("\n"));
  return plugins;
}

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** The files of a folder, relative to it, with "/". */
function filesOf(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(dir, path.join(d.parentPath, d.name)).split(path.sep).join("/"));
}

/**
 * tar's arguments for `out`, the files of `dir`, named alike on every run. GNU tar (GitHub Actions) also sorts them;
 * the tar of macOS (bsdtar) takes neither --sort nor --owner, and makes only the archive of --dry-run.
 */
function tarArgs(gnu: boolean, out: string, dir: string): string[] {
  return gnu
    ? ["-czf", out, "-C", dir, "--sort=name", "--owner=0", "--group=0", "--numeric-owner", "."]
    : ["-czf", out, "-C", dir, "--uid", "0", "--gid", "0", "--numeric-owner", "--no-mac-metadata", "."];
}

/**
 * The files of `folder` that changed from its release `tag` (the commit it was made at) to HEAD, but for its README.md,
 * test/ and the tests of src/, which are not in its file. Only those: a build can take in other files as text (the
 * kanban's daemon.js has kanban/plugins/, with its .md and tests). Its gasho-plugin.json counts when it is not the one in
 * the released file, but for its genre, which only the catalog has. Undefined when git does not have the tag.
 */
function changesSince(root: string, folder: string, tag: string, released: Manifest, current: Manifest): string[] | undefined {
  const git = (args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    git(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`]);
  } catch {
    return undefined;
  }
  const files = git([
    "diff", "--name-only", `refs/tags/${tag}`, "HEAD", "--", folder,
    `:(exclude)${folder}/gasho-plugin.json`,
    `:(exclude)${folder}/README.md`,
    `:(exclude)${folder}/test`,
    `:(exclude,glob)${folder}/src/**/*.test.ts`,
  ]).split("\n").filter(Boolean);
  const { genre: _a, ...was } = released;
  const { genre: _b, ...now } = current;
  return isDeepStrictEqual(was, now) ? files : [`${folder}/gasho-plugin.json`, ...files];
}

/**
 * Whether HEAD gives `folder` a lower version than its first parent does: for a pull request's merge commit, its base.
 * True without a first parent, or when it has no such plugin: the version is then HEAD's own.
 */
function lowersVersion(root: string, folder: string, version: string): boolean {
  let parent: unknown;
  try {
    parent = JSON.parse(execFileSync("git", ["-C", root, "show", `HEAD^1:${folder}/gasho-plugin.json`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch {
    return true;
  }
  const was = (parent as Manifest).version;
  return typeof was !== "string" || !VERSION_RE.test(was) || compareVersions(version, was) < 0;
}

/** A release as GitHub's REST API gives it (GET /repos/{owner}/{repo}/releases). */
interface ApiRelease {
  id: number;
  tag_name: string;
  draft: boolean;
  assets: { id: number; name: string }[];
}

export interface ReleaseOptions {
  /** The root of the repository of plugins. */
  root: string;
  /** owner/name, given to gh as --repo. */
  repo: string;
  /** The commit new releases are made at (GITHUB_SHA); without it, GitHub's default branch. */
  target?: string;
  /** The branch it releases from (GITHUB_REF_NAME): once it is at another commit than `target`, nothing is released. */
  branch?: string;
  /** Says what it would release and how the catalog would be, and changes nothing. */
  dry: boolean;
  /** Runs gh with these arguments and gives its stdout; throws when gh fails. */
  gh: (args: string[]) => string;
  log: (line: string) => void;
}

/**
 * Releases the plugins whose version has no release yet, and uploads catalog.json again when it changes. Gives the
 * plugins changed since their release, and the warnings of a dry run. Throws, before releasing anything, when a plugin
 * cannot be released.
 */
export function release(o: ReleaseOptions): { unreleased: Unreleased[]; warnings: Problem[] } {
  const { root, repo, target, branch, dry, log } = o;
  // gh api takes the repository in its path.
  const gh = (args: string[]) => o.gh(args[0] === "api" ? args : [...args, "--repo", repo]);
  const releases = (JSON.parse(gh(["api", `repos/${repo}/releases?per_page=100`, "--paginate", "--slurp"])) as ApiRelease[][]).flat();
  if (!dry && target && branch) {
    // A run started again, or one that waited for another: the run of the newer commit releases what this one would.
    const head = gh(["api", `repos/${repo}/commits/${branch}`, "--jq", ".sha"]).trim();
    if (head !== target) {
      log(`${branch} is at ${head} now, not ${target}: nothing is released from this older commit`);
      return { unreleased: [], warnings: [] };
    }
  }
  // A draft is what a run that stopped halfway leaves: it has no tag, and no one can download its file.
  const published = releases.filter((r) => !r.draft);
  const has = (r: ApiRelease | undefined, file: string) => r?.assets.some((a) => a.name === file) ?? false;
  /** The versions of a plugin released with their file. */
  const versionsOf = (id: string) =>
    published.flatMap((r) => {
      const v = r.tag_name.startsWith(`${id}-v`) ? r.tag_name.slice(id.length + 2) : "";
      return VERSION_RE.test(v) && has(r, `${id}-${v}.tgz`) ? [v] : [];
    });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gasho-plugins-release-"));
  let gnu: boolean | undefined;
  try {
    const catalogRelease = published.find((r) => r.tag_name === CATALOG_RELEASE);
    // catalog-next.json alone: a run stopped before it took the name catalog.json.
    const beforeFile = [CATALOG_FILE, NEXT_CATALOG_FILE].find((f) => has(catalogRelease, f));
    let before: Catalog | undefined;
    if (beforeFile) {
      gh(["release", "download", CATALOG_RELEASE, "--pattern", beforeFile, "--dir", tmp]);
      before = JSON.parse(fs.readFileSync(path.join(tmp, beforeFile), "utf8")) as Catalog;
      fs.rmSync(path.join(tmp, beforeFile));
    }

    const genres = readGenres(root).map(({ id, name }) => ({ id, name }));
    const problems: string[] = [];
    const unreleased: Unreleased[] = [];
    const warnings: Problem[] = [];
    const entries: CatalogEntry[] = [];
    const made: { m: CheckedManifest; out: string; size: number }[] = [];
    for (const { folder, manifest: m } of readPlugins(root)) {
      const versions = versionsOf(m.id);
      const newest = versions.sort(compareVersions).at(-1);
      if (newest !== undefined && compareVersions(m.version, newest) < 0) {
        const file = `${folder}/gasho-plugin.json`;
        // A dry run of a commit behind the releases (a run started again, a branch behind main) fails only when the commit
        // itself lowers the version: otherwise the pull request has no version to give.
        if (dry && !lowersVersion(root, folder, m.version)) {
          warnings.push({ file, message: `${m.id} ${m.version} is older than ${newest}, released after the commit this one is based on: merge main to check it again` });
          log(`${m.id} ${m.version}: older than ${newest}, released already, but not lowered by this commit`);
          continue;
        }
        problems.push(`${file}: version ${m.version} is older than ${newest}, released already: give a version above it`);
        continue;
      }
      if (versions.includes(m.version)) {
        const dir = path.join(tmp, "released", m.id);
        fs.mkdirSync(dir, { recursive: true });
        gh(["release", "download", releaseOf(m), "--pattern", fileOf(m), "--dir", dir]);
        const data = fs.readFileSync(path.join(dir, fileOf(m)));
        const files = path.join(dir, "files");
        fs.mkdirSync(files);
        execFileSync("tar", ["-xzf", path.join(dir, fileOf(m)), "-C", files]);
        const released = JSON.parse(fs.readFileSync(path.join(files, "gasho-plugin.json"), "utf8")) as Manifest;
        if (released.id !== m.id || released.version !== m.version) {
          problems.push(`${releaseOf(m)}: ${fileOf(m)} holds ${released.id} ${released.version}`);
          continue;
        }
        entries.push(entryOf({ ...released, genre: m.genre }, { sha256: sha256(data), size: data.length }));
        const changed = changesSince(root, folder, releaseOf(m), released, m);
        if (changed === undefined) log(`${m.id} ${m.version}: released before; git has no tag ${releaseOf(m)} to tell what changed since (git fetch --tags)`);
        else if (changed.length > 0) {
          unreleased.push({ folder, id: m.id, version: m.version, files: changed });
          log(`${m.id} ${m.version}: released before; ${changed.length} file(s) changed since are not released`);
        } else log(`${m.id} ${m.version}: released before`);
        continue;
      }
      const dist = path.join(root, folder, "dist");
      let built: unknown;
      try {
        built = JSON.parse(fs.readFileSync(path.join(dist, "gasho-plugin.json"), "utf8"));
      } catch {
        built = undefined;
      }
      if (!isDeepStrictEqual(built, m)) {
        problems.push(`${folder}/dist is not the build of ${folder}/gasho-plugin.json: run npm run build first`);
        continue;
      }
      const files = path.join(tmp, "files", m.id);
      fs.cpSync(dist, files, { recursive: true });
      // An upstream license (the themes') goes with the files.
      if (fs.existsSync(path.join(root, folder, "LICENSE"))) fs.copyFileSync(path.join(root, folder, "LICENSE"), path.join(files, "LICENSE"));
      const wrong = checkManifest(built, { folder, files: new Set(filesOf(files)) });
      if (wrong.length > 0) {
        problems.push(...wrong.map((w) => `${folder}/dist/gasho-plugin.json: ${w}`));
        continue;
      }
      const out = path.join(tmp, fileOf(m));
      gnu ??= execFileSync("tar", ["--version"], { encoding: "utf8" }).includes("GNU tar");
      execFileSync("tar", tarArgs(gnu, out, files));
      const data = fs.readFileSync(out);
      entries.push(entryOf(m, { sha256: sha256(data), size: data.length }));
      made.push({ m, out, size: data.length });
    }
    if (problems.length > 0) throw new Error(problems.join("\n"));

    for (const { m, out, size } of made) {
      if (dry) {
        log(`${m.id} ${m.version}: would release ${fileOf(m)} (${size} bytes) as ${releaseOf(m)}`);
        continue;
      }
      for (const draft of releases.filter((r) => r.draft && r.tag_name === releaseOf(m))) {
        gh(["api", "-X", "DELETE", `repos/${repo}/releases/${draft.id}`]);
      }
      if (published.some((r) => r.tag_name === releaseOf(m))) gh(["release", "upload", releaseOf(m), out]);
      else {
        gh([
          "release", "create", releaseOf(m), out,
          "--title", `${m.name} ${m.version}`,
          "--notes", m.description ?? m.name,
          "--latest=false",
          ...(target ? ["--target", target] : []),
        ]);
      }
      log(`${m.id} ${m.version}: released as ${releaseOf(m)}`);
    }

    const catalog: Catalog = { repo, updatedAt: new Date().toISOString(), genres, plugins: entries.sort((a, b) => (a.id < b.id ? -1 : 1)) };
    if (beforeFile === CATALOG_FILE && sameCatalog(before, catalog)) {
      log("catalog.json: no change");
      return { unreleased, warnings };
    }
    const text = `${JSON.stringify(catalog, null, 2)}\n`;
    if (dry) {
      log(`catalog.json: would be\n${text}`);
      return { unreleased, warnings };
    }
    if (!catalogRelease) {
      gh([
        "release", "create", CATALOG_RELEASE,
        "--title", "カタログ",
        "--notes", "Gasho のプラグインの画面が読む、プラグインの一覧（catalog.json）。main に push すると、GitHub Actions が作り直す。",
        "--latest=false",
        ...(target ? ["--target", target] : []),
      ]);
    }
    // Gasho servers read catalog.json at any time: the old one goes only once the new one is uploaded.
    const stale = catalogRelease?.assets.find((a) => a.name === NEXT_CATALOG_FILE);
    if (stale) gh(["api", "-X", "DELETE", `repos/${repo}/releases/assets/${stale.id}`]);
    const file = path.join(tmp, NEXT_CATALOG_FILE);
    fs.writeFileSync(file, text);
    gh(["release", "upload", CATALOG_RELEASE, file]);
    const assets = (JSON.parse(gh(["api", `repos/${repo}/releases/tags/${CATALOG_RELEASE}`])) as ApiRelease).assets;
    const next = assets.find((a) => a.name === NEXT_CATALOG_FILE);
    if (!next) throw new Error(`the release ${CATALOG_RELEASE} has no ${NEXT_CATALOG_FILE} after it was uploaded`);
    const old = assets.find((a) => a.name === CATALOG_FILE);
    if (old) gh(["api", "-X", "DELETE", `repos/${repo}/releases/assets/${old.id}`]);
    gh(["api", "-X", "PATCH", `repos/${repo}/releases/assets/${next.id}`, "-f", `name=${CATALOG_FILE}`]);
    log(`catalog.json: ${catalog.plugins.map((p) => `${p.id} ${p.version}`).join(", ")}`);
    return { unreleased, warnings };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const actions = process.env.GITHUB_ACTIONS === "true";
  const dry = process.argv.includes("--dry-run");
  try {
    const { unreleased, warnings } = release({
      root: path.resolve(import.meta.dirname, ".."),
      repo: process.env.GITHUB_REPOSITORY ?? "4rtofl/GashoPlugins",
      target: process.env.GITHUB_SHA,
      branch: process.env.GITHUB_REF_NAME,
      dry,
      // The list of releases grows by about 4 KB a release, past execFileSync's 1 MiB at about 270 releases.
      gh: (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 256 * 1024 * 1024 }),
      log: (line) => console.log(line),
    });
    for (const w of [...warnings, ...unreleased.map(unreleasedWarning)]) console.log(actions ? annotation("warning", w) : `warning: ${w.file}: ${w.message}`);
    if (unreleased.length > 0 && process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, unreleasedSummary(unreleased));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
