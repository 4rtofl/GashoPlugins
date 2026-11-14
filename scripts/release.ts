// Releases the plugins whose version has no release yet, and remakes the catalog that Gasho's plugins screen reads
// (Gasho's docs/plugins.md, P10). For each plugin (a workspace with a gasho-plugin.json), the release
// <id>-v<version> holds <id>-<version>.tgz, the files of its dist/. The release "catalog" holds catalog.json, the
// newest version of every plugin with the SHA-256 of its file. Releases of older versions stay.
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
  api: string;
  permissions?: string[];
  daemon?: { js: string };
}

/** One plugin of catalog.json (Gasho's CatalogPlugin). */
export interface CatalogEntry {
  id: string;
  name: string;
  version: string;
  description?: string;
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
  plugins: CatalogEntry[];
}

export const CATALOG_RELEASE = "catalog";
export const releaseOf = (m: Manifest) => `${m.id}-v${m.version}`;
export const fileOf = (m: Manifest) => `${m.id}-${m.version}.tgz`;

/** The catalog's entry for a plugin's file. */
export function entryOf(m: Manifest, file: { sha256: string; size: number }): CatalogEntry {
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    ...(m.description ? { description: m.description } : {}),
    api: m.api,
    permissions: m.permissions ?? [],
    daemon: Boolean(m.daemon),
    release: releaseOf(m),
    file: fileOf(m),
    sha256: file.sha256,
    size: file.size,
  };
}

/** Whether two catalogs list the same plugins (when they were made aside). */
export function sameCatalog(a: Catalog | undefined, b: Catalog): boolean {
  return a !== undefined && a.repo === b.repo && JSON.stringify(a.plugins) === JSON.stringify(b.plugins);
}

/** The plugins of the workspace: each folder of `workspaces` that has a gasho-plugin.json named after it. */
export function readPlugins(root: string): { folder: string; manifest: Manifest }[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { workspaces?: string[] };
  return (pkg.workspaces ?? []).flatMap((folder) => {
    const file = path.join(root, folder, "gasho-plugin.json");
    if (!fs.existsSync(file)) return [];
    const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
    if (manifest.id !== folder) throw new Error(`${folder}/gasho-plugin.json: its id (${manifest.id}) is not the folder's name`);
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version)) throw new Error(`${folder}/gasho-plugin.json: version ${manifest.version} is not like 1.2.0`);
    return [{ folder, manifest }];
  });
}

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

function main(): void {
  const root = path.resolve(import.meta.dirname, "..");
  const dry = process.argv.includes("--dry-run");
  const repo = process.env.GITHUB_REPOSITORY ?? "4rtoflow/GashoPlugins";
  const target = process.env.GITHUB_SHA;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gasho-plugins-release-"));
  const gh = (args: string[]) => execFileSync("gh", [...args, "--repo", repo], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const tryGh = (args: string[]) => {
    try {
      return gh(args);
    } catch {
      return undefined;
    }
  };
  try {
    const releases = new Set(gh(["release", "list", "--limit", "1000", "--json", "tagName", "--jq", ".[].tagName"]).split("\n").filter(Boolean));
    let before: Catalog | undefined;
    if (releases.has(CATALOG_RELEASE) && tryGh(["release", "download", CATALOG_RELEASE, "--pattern", "catalog.json", "--dir", tmp]) !== undefined) {
      before = JSON.parse(fs.readFileSync(path.join(tmp, "catalog.json"), "utf8")) as Catalog;
      fs.rmSync(path.join(tmp, "catalog.json"));
    }

    const entries: CatalogEntry[] = [];
    for (const { folder, manifest: m } of readPlugins(root)) {
      if (releases.has(releaseOf(m))) {
        // Released before: its entry as the catalog has it, or from its file.
        const known = before?.plugins.find((p) => p.id === m.id && p.version === m.version && p.file === fileOf(m));
        if (known) {
          entries.push(entryOf(m, known));
          console.log(`${m.id} ${m.version}: released before`);
          continue;
        }
        gh(["release", "download", releaseOf(m), "--pattern", fileOf(m), "--dir", tmp]);
        const data = fs.readFileSync(path.join(tmp, fileOf(m)));
        entries.push(entryOf(m, { sha256: sha256(data), size: data.length }));
        console.log(`${m.id} ${m.version}: released before`);
        continue;
      }
      const dist = path.join(root, folder, "dist");
      const built = JSON.parse(fs.readFileSync(path.join(dist, "gasho-plugin.json"), "utf8")) as Manifest;
      if (built.id !== m.id || built.version !== m.version) throw new Error(`${folder}/dist is not ${m.id} ${m.version}: run npm run build first`);
      const out = path.join(tmp, fileOf(m));
      execFileSync("tar", ["-czf", out, "-C", dist, "--sort=name", "--owner=0", "--group=0", "--numeric-owner", "."]);
      const data = fs.readFileSync(out);
      entries.push(entryOf(m, { sha256: sha256(data), size: data.length }));
      if (dry) {
        console.log(`${m.id} ${m.version}: would release ${fileOf(m)} (${data.length} bytes) as ${releaseOf(m)}`);
        continue;
      }
      gh([
        "release", "create", releaseOf(m), out,
        "--title", `${m.name} ${m.version}`,
        "--notes", m.description ?? m.name,
        "--latest=false",
        ...(target ? ["--target", target] : []),
      ]);
      console.log(`${m.id} ${m.version}: released as ${releaseOf(m)}`);
    }

    const catalog: Catalog = { repo, updatedAt: new Date().toISOString(), plugins: entries.sort((a, b) => (a.id < b.id ? -1 : 1)) };
    if (sameCatalog(before, catalog)) {
      console.log("catalog.json: no change");
      return;
    }
    const file = path.join(tmp, "catalog.json");
    fs.writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`);
    if (dry) {
      console.log(`catalog.json: would be\n${fs.readFileSync(file, "utf8")}`);
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
    console.log(`catalog.json: ${catalog.plugins.map((p) => `${p.id} ${p.version}`).join(", ")}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.main) main();
