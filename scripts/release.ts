// Releases the plugins whose version has no release yet, and remakes the catalog that Gasho's plugins screen reads
// (Gasho's docs/plugins.md, P10). For each plugin (a workspace with a gasho-plugin.json), the release
// <id>-v<version> holds <id>-<version>.tgz, the files of its dist/. The release "catalog" holds catalog.json, the
// newest version of every plugin with the SHA-256 of its file, and the genres of genres.json, which the plugins screen
// lists the plugins by. Releases of older versions stay. Every plugin names one of the genres (checkPlugins, which
// scripts/check.ts runs on every pull request).
//
// .github/workflows/release.yml runs it on main after `npm run build`, with gh logged in (GH_TOKEN). Run it by hand
// with --dry-run to see what it would do; it then changes nothing.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Manifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** The id of its genre, one of genres.json. */
  genre?: string;
  api: string;
  permissions?: string[];
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

export const CATALOG_RELEASE = "catalog";
const ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
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

/**
 * Checks the plugins of the workspace, each folder of `workspaces` that has a gasho-plugin.json: its id is the folder's
 * name, its version is like 1.2.0, and it names a genre of genres.json. A folder with a gasho-plugin.json that is not a
 * workspace is a problem too: it would be neither built nor checked. Gives the plugins and every problem found.
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
    const before = problems.length;
    const problem = (message: string) => problems.push({ file, message });
    if (manifest.id !== folder) problem(`its id (${manifest.id}) is not the folder's name`);
    if (typeof manifest.version !== "string" || !VERSION_RE.test(manifest.version)) problem(`version ${manifest.version} is not like 1.2.0`);
    if (manifest.genre === undefined) problem(`it names no genre: give "genre", one of genres.json (${ids.join(", ")})`);
    else if (typeof manifest.genre !== "string" || !ids.includes(manifest.genre)) problem(`genre ${JSON.stringify(manifest.genre)} is not in genres.json (${ids.join(", ")})`);
    return problems.length === before ? [{ folder, manifest: manifest as CheckedManifest }] : [];
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

/**
 * tar's arguments for `out`, the files of `dir`, named alike on every run. GNU tar (GitHub Actions) also sorts them;
 * the tar of macOS (bsdtar) takes neither --sort nor --owner, and makes only the archive of --dry-run.
 */
function tarArgs(gnu: boolean, out: string, dir: string): string[] {
  return gnu
    ? ["-czf", out, "-C", dir, "--sort=name", "--owner=0", "--group=0", "--numeric-owner", "."]
    : ["-czf", out, "-C", dir, "--uid", "0", "--gid", "0", "--numeric-owner", "--no-mac-metadata", "."];
}

export interface ReleaseOptions {
  /** The root of the repository of plugins. */
  root: string;
  /** owner/name, given to gh as --repo. */
  repo: string;
  /** The commit new releases are made at (GITHUB_SHA); without it, GitHub's default branch. */
  target?: string;
  /** Says what it would release and how the catalog would be, and changes nothing. */
  dry: boolean;
  /** Runs gh with these arguments and gives its stdout; throws when gh fails. */
  gh: (args: string[]) => string;
  log: (line: string) => void;
}

/** Releases the plugins whose version has no release yet, and uploads catalog.json again when it changes. */
export function release(o: ReleaseOptions): void {
  const { root, repo, target, dry, log } = o;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gasho-plugins-release-"));
  const gh = (args: string[]) => o.gh([...args, "--repo", repo]);
  const tryGh = (args: string[]) => {
    try {
      return gh(args);
    } catch {
      return undefined;
    }
  };
  let gnu: boolean | undefined;
  try {
    const releases = new Set(gh(["release", "list", "--limit", "1000", "--json", "tagName", "--jq", ".[].tagName"]).split("\n").filter(Boolean));
    let before: Catalog | undefined;
    if (releases.has(CATALOG_RELEASE) && tryGh(["release", "download", CATALOG_RELEASE, "--pattern", "catalog.json", "--dir", tmp]) !== undefined) {
      before = JSON.parse(fs.readFileSync(path.join(tmp, "catalog.json"), "utf8")) as Catalog;
      fs.rmSync(path.join(tmp, "catalog.json"));
    }

    const genres = readGenres(root).map(({ id, name }) => ({ id, name }));
    const entries: CatalogEntry[] = [];
    for (const { folder, manifest: m } of readPlugins(root)) {
      if (releases.has(releaseOf(m))) {
        // Released before: its entry as the catalog has it, or from its file.
        const known = before?.plugins.find((p) => p.id === m.id && p.version === m.version && p.file === fileOf(m));
        if (known) {
          entries.push(entryOf(m, known));
          log(`${m.id} ${m.version}: released before`);
          continue;
        }
        gh(["release", "download", releaseOf(m), "--pattern", fileOf(m), "--dir", tmp]);
        const data = fs.readFileSync(path.join(tmp, fileOf(m)));
        entries.push(entryOf(m, { sha256: sha256(data), size: data.length }));
        log(`${m.id} ${m.version}: released before`);
        continue;
      }
      const dist = path.join(root, folder, "dist");
      const built = JSON.parse(fs.readFileSync(path.join(dist, "gasho-plugin.json"), "utf8")) as Manifest;
      if (built.id !== m.id || built.version !== m.version) throw new Error(`${folder}/dist is not ${m.id} ${m.version}: run npm run build first`);
      const out = path.join(tmp, fileOf(m));
      gnu ??= execFileSync("tar", ["--version"], { encoding: "utf8" }).includes("GNU tar");
      execFileSync("tar", tarArgs(gnu, out, dist));
      const data = fs.readFileSync(out);
      entries.push(entryOf(m, { sha256: sha256(data), size: data.length }));
      if (dry) {
        log(`${m.id} ${m.version}: would release ${fileOf(m)} (${data.length} bytes) as ${releaseOf(m)}`);
        continue;
      }
      gh([
        "release", "create", releaseOf(m), out,
        "--title", `${m.name} ${m.version}`,
        "--notes", m.description ?? m.name,
        "--latest=false",
        ...(target ? ["--target", target] : []),
      ]);
      log(`${m.id} ${m.version}: released as ${releaseOf(m)}`);
    }

    const catalog: Catalog = { repo, updatedAt: new Date().toISOString(), genres, plugins: entries.sort((a, b) => (a.id < b.id ? -1 : 1)) };
    if (sameCatalog(before, catalog)) {
      log("catalog.json: no change");
      return;
    }
    const file = path.join(tmp, "catalog.json");
    fs.writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`);
    if (dry) {
      log(`catalog.json: would be\n${fs.readFileSync(file, "utf8")}`);
      return;
    }
    if (!releases.has(CATALOG_RELEASE)) {
      gh([
        "release", "create", CATALOG_RELEASE,
        "--title", "カタログ",
        "--notes", "Gasho のプラグインの画面が読む、プラグインの一覧（catalog.json）。main に push すると、GitHub Actions が作り直す。",
        "--latest=false",
        ...(target ? ["--target", target] : []),
      ]);
    }
    gh(["release", "upload", CATALOG_RELEASE, file, "--clobber"]);
    log(`catalog.json: ${catalog.plugins.map((p) => `${p.id} ${p.version}`).join(", ")}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  release({
    root: path.resolve(import.meta.dirname, ".."),
    repo: process.env.GITHUB_REPOSITORY ?? "4rtofl/GashoPlugins",
    target: process.env.GITHUB_SHA,
    dry: process.argv.includes("--dry-run"),
    gh: (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }),
    log: (line) => console.log(line),
  });
}
