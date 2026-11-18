import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execError, fakeCommands } from "../../test/daemon.ts";
import { report } from "../check.ts";
import { checkPlugins, entryOf, fileOf, readGenres, readPlugins, release, releaseOf, sameCatalog, type Catalog, type CheckedManifest } from "../release.ts";

const manifest: CheckedManifest = { id: "hello", name: "Hello", version: "1.2.0", genre: "devtools", api: "1.1", permissions: ["session.input"], daemon: { js: "daemon.js" } };
const genres = [
  { id: "integration", name: "連携", description: "ほかのサービスとつなぐ" },
  { id: "devtools", name: "開発ツール", description: "開発の道具" },
];

/** A repository of plugins in a temporary folder: package.json, genres.json, and a gasho-plugin.json per folder. */
function repo(plugins: Record<string, object>, opts: { workspaces?: string[]; genres?: unknown } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gasho-plugins-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ workspaces: opts.workspaces ?? Object.keys(plugins) }));
  fs.writeFileSync(path.join(root, "genres.json"), JSON.stringify(opts.genres ?? genres));
  for (const [folder, m] of Object.entries(plugins)) {
    fs.mkdirSync(path.join(root, folder));
    fs.writeFileSync(path.join(root, folder, "gasho-plugin.json"), JSON.stringify(m));
  }
  return root;
}

const problems = (root: string) => checkPlugins(root).problems.map((p) => `${p.file}: ${p.message}`);

test("a plugin's release, file and catalog entry are named after its version, with its genre", () => {
  assert.equal(releaseOf(manifest), "hello-v1.2.0");
  assert.equal(fileOf(manifest), "hello-1.2.0.tgz");
  assert.deepEqual(entryOf(manifest, { sha256: "ab".repeat(32), size: 10 }), {
    id: "hello",
    name: "Hello",
    version: "1.2.0",
    genre: "devtools",
    api: "1.1",
    permissions: ["session.input"],
    daemon: true,
    release: "hello-v1.2.0",
    file: "hello-1.2.0.tgz",
    sha256: "ab".repeat(32),
    size: 10,
  });
  assert.equal(entryOf({ ...manifest, daemon: undefined, permissions: undefined }, { sha256: "", size: 1 }).daemon, false);
});

test("the catalog is uploaded again only when its genres or plugins change", () => {
  const plugins = [entryOf(manifest, { sha256: "ab".repeat(32), size: 10 })];
  const a = { repo: "o/p", updatedAt: "2026-11-14T00:00:00Z", genres: [{ id: "devtools", name: "開発ツール" }], plugins };
  assert.equal(sameCatalog(undefined, a), false);
  assert.equal(sameCatalog(a, { ...a, updatedAt: "2026-11-15T00:00:00Z" }), true);
  assert.equal(sameCatalog(a, { ...a, plugins: [{ ...plugins[0]!, version: "1.3.0" }] }), false);
  assert.equal(sameCatalog(a, { ...a, genres: [{ id: "devtools", name: "道具" }] }), false);
  // A catalog made before genres had none.
  const { genres: _, ...old } = a;
  assert.equal(sameCatalog(old as typeof a, a), false);
});

test("genres.json lists genres with an id of the right form, a name and a description, each id once", () => {
  assert.deepEqual(readGenres(repo({})), genres);
  assert.throws(() => readGenres(repo({}, { genres: [] })), /in an array/);
  assert.throws(() => readGenres(repo({}, { genres: { devtools: "開発ツール" } })), /in an array/);
  assert.throws(() => readGenres(repo({}, { genres: [{ ...genres[0], id: "Dev Tools" }] })), /genre 1 \(Dev Tools\): id must be/);
  assert.throws(() => readGenres(repo({}, { genres: [genres[0], genres[0]] })), /genre 2 \(integration\): the id is there twice/);
  assert.throws(() => readGenres(repo({}, { genres: [{ ...genres[0], name: "" }] })), /name must be 1-40 characters/);
  assert.throws(() => readGenres(repo({}, { genres: [{ ...genres[0], description: undefined }] })), /give a description/);
});

test("the plugins are the workspaces with a gasho-plugin.json named after them, each naming a genre of genres.json", () => {
  const root = repo({ hello: manifest }, { workspaces: ["hello", "tools"] });
  assert.deepEqual(readPlugins(root), [{ folder: "hello", manifest }]);
  const write = (m: object) => fs.writeFileSync(path.join(root, "hello", "gasho-plugin.json"), JSON.stringify(m));
  write({ ...manifest, id: "other" });
  assert.throws(() => readPlugins(root), /hello\/gasho-plugin\.json: its id \(other\) is not the folder's name/);
  write({ ...manifest, version: "1.2" });
  assert.throws(() => readPlugins(root), /not like 1\.2\.0/);
  write({ ...manifest, genre: undefined });
  assert.throws(() => readPlugins(root), /it names no genre: give "genre", one of genres\.json \(integration, devtools\)/);
  write({ ...manifest, genre: "tools" });
  assert.throws(() => readPlugins(root), /genre "tools" is not in genres\.json \(integration, devtools\)/);
  write({ ...manifest, genre: ["devtools"] });
  assert.throws(() => readPlugins(root), /genre \["devtools"\] is not in genres\.json/);
});

test("checkPlugins names every problem, a plugin folder left out of the workspaces, and a broken genres.json", () => {
  const { genre: _, ...noGenre } = manifest;
  const root = repo({ hello: { ...noGenre, version: "x" }, ok: { ...manifest, id: "ok" }, stray: { ...manifest, id: "stray" } }, { workspaces: ["hello", "ok"] });
  fs.mkdirSync(path.join(root, "broken"));
  fs.writeFileSync(path.join(root, "broken", "gasho-plugin.json"), "{");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { workspaces: string[] };
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ workspaces: [...pkg.workspaces, "broken"] }));
  assert.deepEqual(
    checkPlugins(root).plugins.map((p) => p.folder),
    ["ok"],
  );
  const found = problems(root);
  assert.equal(found.length, 4);
  assert.equal(found[0], "hello/gasho-plugin.json: version x is not like 1.2.0");
  assert.equal(found[1], 'hello/gasho-plugin.json: it names no genre: give "genre", one of genres.json (integration, devtools)');
  assert.match(found[2] ?? "", /^broken\/gasho-plugin\.json: it is not JSON \(/);
  assert.equal(found[3], "stray/gasho-plugin.json: stray is not in the workspaces of package.json, so it is neither built nor released");
  fs.writeFileSync(path.join(root, "genres.json"), "[]");
  assert.deepEqual(problems(root), ["genres.json: list the genres in an array"]);
});

test("in GitHub Actions, each problem is an error annotation on its file", () => {
  const found = [{ file: "hello/gasho-plugin.json", message: 'genre "tools" is not in genres.json (integration, devtools)\n100%' }];
  assert.deepEqual(report(found, false), ['hello/gasho-plugin.json: genre "tools" is not in genres.json (integration, devtools)\n100%']);
  assert.deepEqual(report(found, true), ['::error file=hello/gasho-plugin.json,title=gasho-plugin.json::genre "tools" is not in genres.json (integration, devtools)%0A100%25']);
});

test("every plugin of this repository names a genre of genres.json", () => {
  const root = path.resolve(import.meta.dirname, "..", "..");
  assert.deepEqual(checkPlugins(root).problems, []);
});

/** Writes what `npm run build` would into `folder`/dist: its gasho-plugin.json and web.js. */
function build(root: string, folder: string, m: object): void {
  fs.mkdirSync(path.join(root, folder, "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, folder, "dist", "gasho-plugin.json"), JSON.stringify(m));
  fs.writeFileSync(path.join(root, folder, "dist", "web.js"), `export default "${folder}";\n`);
}

const arg = (args: string[], name: string) => args[args.indexOf(name) + 1] ?? "";
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/**
 * gh with the releases of `releases`, the catalog.json of the release "catalog" (`catalog`) and the files of other
 * releases (`files`). What `release create` and `release upload` were given is read while the file is there.
 */
function github(o: { releases: string[]; catalog?: Catalog; files?: Record<string, Buffer> }) {
  const created = new Map<string, Buffer>();
  let uploaded: Catalog | undefined;
  const gh = fakeCommands(({ args }) => {
    const [, sub, tag] = args;
    if (sub === "list") return `${o.releases.join("\n")}\n`;
    if (sub === "download") {
      const name = arg(args, "--pattern");
      const data = name === "catalog.json" ? (o.catalog && Buffer.from(JSON.stringify(o.catalog))) : o.files?.[name];
      if (!data) return execError({ stderr: "no assets match the file pattern" });
      fs.writeFileSync(path.join(arg(args, "--dir"), name), data);
      return "";
    }
    if (sub === "create") {
      if (tag !== "catalog") created.set(tag ?? "", fs.readFileSync(args[3] ?? ""));
      return "";
    }
    if (sub === "upload") {
      uploaded = JSON.parse(fs.readFileSync(args[3] ?? "", "utf8")) as Catalog;
      return "";
    }
    return execError({ stderr: `unknown command "${sub}"` });
  });
  return {
    calls: gh.calls,
    created,
    uploaded: () => uploaded,
    run: (args: string[]) => gh.runSync({ command: "gh", args, via: "exec" }).stdout,
    /** The gh commands, without --repo (which every one has), with "<tmp>" for release's temporary folder. */
    commands: () =>
      gh.calls.map(({ args }) => {
        assert.deepEqual(args.slice(-2), ["--repo", "o/p"]);
        return args.slice(0, -2).map((a) => a.replace(/^.*\/gasho-plugins-release-[^/]+/, "<tmp>"));
      }),
  };
}

const hello: CheckedManifest = { ...manifest, description: "あいさつする" };
const old: CheckedManifest = { ...manifest, id: "old", name: "Old", version: "1.0.0" };
const oldEntry = entryOf(old, { sha256: "cd".repeat(32), size: 20 });
const catalogOf = (plugins: ReturnType<typeof entryOf>[]): Catalog => ({ repo: "o/p", updatedAt: "2026-11-14T00:00:00Z", genres: genres.map(({ id, name }) => ({ id, name })), plugins });

test("release publishes a new version with the files of its dist/, and uploads the catalog made again", () => {
  const root = repo({ hello, old });
  build(root, "hello", hello);
  const gh = github({ releases: ["catalog", "old-v1.0.0", "hello-v1.1.0"], catalog: catalogOf([oldEntry]) });
  const log: string[] = [];
  release({ root, repo: "o/p", target: "abc123", dry: false, gh: gh.run, log: (line) => log.push(line) });

  assert.deepEqual(gh.commands(), [
    ["release", "list", "--limit", "1000", "--json", "tagName", "--jq", ".[].tagName"],
    ["release", "download", "catalog", "--pattern", "catalog.json", "--dir", "<tmp>"],
    ["release", "create", "hello-v1.2.0", "<tmp>/hello-1.2.0.tgz", "--title", "Hello 1.2.0", "--notes", "あいさつする", "--latest=false", "--target", "abc123"],
    ["release", "upload", "catalog", "<tmp>/catalog.json", "--clobber"],
  ]);
  const archive = gh.created.get("hello-v1.2.0");
  assert.ok(archive);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gasho-plugins-")), "hello.tgz");
  fs.writeFileSync(file, archive);
  const files = execFileSync("tar", ["-tzf", file], { encoding: "utf8" }).split("\n");
  assert.deepEqual(files.filter((f) => f && !f.endsWith("/")).sort(), ["./gasho-plugin.json", "./web.js"]);

  const uploaded = gh.uploaded();
  assert.deepEqual(uploaded?.plugins, [entryOf(hello, { sha256: sha(archive), size: archive.length }), oldEntry]);
  assert.deepEqual(uploaded?.genres, catalogOf([]).genres);
  assert.deepEqual(log.slice(0, 2), ["hello 1.2.0: released as hello-v1.2.0", "old 1.0.0: released before"]);
});

test("release --dry-run reads GitHub and makes the archive, and changes nothing", () => {
  const root = repo({ hello, old });
  build(root, "hello", hello);
  const gh = github({ releases: ["catalog", "old-v1.0.0"], catalog: catalogOf([oldEntry]) });
  const log: string[] = [];
  release({ root, repo: "o/p", dry: true, gh: gh.run, log: (line) => log.push(line) });
  assert.deepEqual(
    gh.commands().map((c) => c.slice(0, 2)),
    [
      ["release", "list"],
      ["release", "download"],
    ],
  );
  assert.match(log[0] ?? "", /^hello 1\.2\.0: would release hello-1\.2\.0\.tgz \(\d+ bytes\) as hello-v1\.2\.0$/);
  assert.match(log.at(-1) ?? "", /^catalog\.json: would be\n\{/);
});

test("release reads a released version missing from the catalog from its file, and makes the catalog's release when there is none", () => {
  const root = repo({ hello });
  const file = Buffer.from("the file released before");
  const gh = github({ releases: ["hello-v1.2.0"], files: { "hello-1.2.0.tgz": file } });
  release({ root, repo: "o/p", dry: false, gh: gh.run, log: () => undefined });
  assert.deepEqual(
    gh.commands().map((c) => c.slice(0, 3)),
    [
      ["release", "list", "--limit"],
      ["release", "download", "hello-v1.2.0"],
      ["release", "create", "catalog"],
      ["release", "upload", "catalog"],
    ],
  );
  // Without GITHUB_SHA, GitHub's default branch.
  assert.ok(!gh.calls[2]?.args.includes("--target"));
  assert.deepEqual(gh.uploaded()?.plugins, [entryOf(hello, { sha256: sha(file), size: file.length })]);
});

test("release uploads no catalog when nothing changed, and stops when dist/ is not the version", () => {
  const root = repo({ hello, old });
  const same = github({ releases: ["catalog", "hello-v1.2.0", "old-v1.0.0"], catalog: catalogOf([entryOf(hello, { sha256: "ef".repeat(32), size: 1 }), oldEntry]) });
  const log: string[] = [];
  release({ root, repo: "o/p", dry: false, gh: same.run, log: (line) => log.push(line) });
  assert.equal(same.calls.length, 2);
  assert.equal(log.at(-1), "catalog.json: no change");

  build(root, "hello", { ...hello, version: "1.1.0" });
  const gh = github({ releases: ["catalog", "old-v1.0.0"], catalog: catalogOf([oldEntry]) });
  assert.throws(() => release({ root, repo: "o/p", dry: false, gh: gh.run, log: () => undefined }), /hello\/dist is not hello 1\.2\.0: run npm run build first/);
  assert.ok(gh.calls.every((c) => c.args[1] === "list" || c.args[1] === "download"));
});
