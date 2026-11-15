import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { report } from "../check.ts";
import { checkPlugins, entryOf, fileOf, readGenres, readPlugins, releaseOf, sameCatalog, type CheckedManifest } from "../release.ts";

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
