import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { report } from "../check.ts";
import { checkManifest } from "../manifest.ts";
import {
  annotation,
  checkPlugins,
  entryOf,
  fileOf,
  readGenres,
  readPlugins,
  release,
  releaseOf,
  sameCatalog,
  unreleasedWarning,
  type Catalog,
  type CatalogEntry,
  type CheckedManifest,
  type Manifest,
} from "../release.ts";

const manifest: CheckedManifest = { id: "hello", name: "Hello", version: "1.2.0", genre: "devtools", api: "1.1", permissions: ["session.input"], daemon: { js: "daemon.js" } };
const genres = [
  { id: "integration", name: "連携", description: "ほかのサービスとつなぐ" },
  { id: "devtools", name: "開発ツール", description: "開発の道具" },
];

/**
 * A repository of plugins in a temporary folder: package.json, genres.json, and a gasho-plugin.json and a package.json
 * with a typecheck script per folder.
 */
function repo(plugins: Record<string, object>, opts: { workspaces?: string[]; genres?: unknown } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gasho-plugins-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ workspaces: opts.workspaces ?? Object.keys(plugins) }));
  fs.writeFileSync(path.join(root, "genres.json"), JSON.stringify(opts.genres ?? genres));
  for (const [folder, m] of Object.entries(plugins)) {
    fs.mkdirSync(path.join(root, folder));
    fs.writeFileSync(path.join(root, folder, "gasho-plugin.json"), JSON.stringify(m));
    fs.writeFileSync(path.join(root, folder, "package.json"), JSON.stringify({ scripts: { typecheck: "tsc -p tsconfig.json" } }));
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
  assert.equal(annotation("warning", { file: "a,b/package.json", message: "x" }), "::warning file=a%2Cb/package.json,title=package.json::x");
});

test("checkManifest refuses what a Gasho server refuses", () => {
  const web = { id: "hello", name: "Hello", version: "1.2.0", api: "1.6", web: { js: "web.js" } };
  const wrong = (m: object) => checkManifest({ ...web, ...m });
  assert.deepEqual(wrong({}), []);
  assert.deepEqual(wrong({ name: "n".repeat(41) }), ["name must be 1-40 characters"]);
  assert.deepEqual(wrong({ description: "d".repeat(301) }), ["description must be up to 300 characters"]);
  assert.deepEqual(wrong({ api: "1" }), ['api "1" is not like 1.0']);
  assert.deepEqual(wrong({ api: "2.0" }), ["api 2.0 is not of the plugin API 1"]);
  assert.deepEqual(wrong({ permissions: ["session.read"] }), ["permissions can name only session.input, session.launch, session.remove, worktree.remove"]);
  assert.deepEqual(wrong({ web: undefined }), ["give web, daemon or theme (or several)"]);
  assert.deepEqual(wrong({ web: { js: "../web.js" } }), ["web.js must name a file inside the plugin's folder"]);
  assert.deepEqual(wrong({ methods: { list: { kind: "read" } } }), ["methods needs daemon"]);
  assert.deepEqual(wrong({ daemon: { js: "daemon.js" }, methods: { list: { kind: "read", timeoutSeconds: 180 }, "2x": { kind: "read" }, get: { kind: "get" } } }), [
    "methods.list.timeoutSeconds must be a number of seconds up to 120",
    "methods has a name that is not right (2x)",
    "methods.get.kind must be read or write",
  ]);
  assert.deepEqual(wrong({ settings: { mode: { type: "boolean", label: "Mode", scope: "page" } } }), ["settings.mode.scope must be browser or server"]);
  assert.deepEqual(wrong({ settings: { mode: { type: "select", label: "Mode", scope: "server", options: [{ value: "a", label: "A" }], default: "b" } } }), [
    "settings.mode.default must be one of the options",
  ]);
  // A theme: from the plugin API 1.6, with names the SDK knows, each value staying in its declaration.
  const theme = { ...web, web: undefined, theme: { background: "#000" } };
  assert.deepEqual(checkManifest(theme), []);
  assert.deepEqual(checkManifest({ ...theme, api: "1.5" }), ["theme needs api 1.6 or later"]);
  assert.deepEqual(checkManifest({ ...theme, theme: { backdrop: "#000" } }), ["theme has no name backdrop"]);
  assert.deepEqual(checkManifest({ ...theme, theme: { background: "#000; color: red" } }), ["theme.background must be a value of up to 64 characters without ; { }"]);
  // In dist/, the files it names are there.
  assert.deepEqual(checkManifest({ ...web, web: { js: "web.js", css: "web.css" } }, { files: new Set(["gasho-plugin.json", "web.js"]) }), [
    "web.css names web.css, which is not there: run npm run build first",
  ]);
});

test("a plugin with sources has a typecheck script, so that npm run typecheck checks its types; a theme needs none", () => {
  const theme = { id: "dark", name: "Dark", version: "1.0.0", genre: "devtools", api: "1.6", theme: { background: "#000" } };
  const root = repo({ hello: manifest, dark: theme });
  fs.rmSync(path.join(root, "hello", "package.json"));
  fs.writeFileSync(path.join(root, "dark", "package.json"), JSON.stringify({ scripts: { build: "gasho-plugin build" } }));
  assert.deepEqual(problems(root), ['hello/package.json: it has no "typecheck" script, so npm run typecheck does not check the types of hello']);
});

test("every plugin of this repository names a genre of genres.json", () => {
  const root = path.resolve(import.meta.dirname, "..", "..");
  assert.deepEqual(checkPlugins(root).problems, []);
});

const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const run = (cmd: string, args: string[], cwd?: string) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1" } });

/** Writes files, by their path from `root`. */
function write(root: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
}

/** Commits every file of `root` but dist/, and tags the commit with `tags`; the first time, makes it a git repository. */
function commit(root: string, ...tags: string[]): void {
  if (!fs.existsSync(path.join(root, ".git"))) {
    fs.writeFileSync(path.join(root, ".gitignore"), "dist/\n");
    run("git", ["init", "-q", "-b", "main"], root);
  }
  run("git", ["add", "-A"], root);
  run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "change"], root);
  for (const tag of tags) run("git", ["tag", tag], root);
}

/** What `npm run build` would write into `folder`/dist: its gasho-plugin.json and the files it names. */
function build(root: string, folder: string): void {
  const m = JSON.parse(fs.readFileSync(path.join(root, folder, "gasho-plugin.json"), "utf8")) as Manifest;
  const files = Object.fromEntries([m.web?.js, m.web?.css, m.daemon?.js].flatMap((f) => (f ? [[`${folder}/dist/${f}`, `/* ${folder} */\n`]] : [])));
  write(root, { ...files, [`${folder}/dist/gasho-plugin.json`]: JSON.stringify(m) });
}

/** A released file: the tgz of `files`. */
function tgz(files: Record<string, string>): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gasho-plugins-"));
  write(dir, files);
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gasho-plugins-")), "file.tgz");
  run("tar", ["-czf", out, "-C", dir, "."]);
  return fs.readFileSync(out);
}

/** The files in a tgz, sorted. */
function tgzFiles(data: Buffer): string[] {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gasho-plugins-")), "file.tgz");
  fs.writeFileSync(file, data);
  return run("tar", ["-tzf", file]).split("\n").filter((f) => f && !f.endsWith("/")).map((f) => f.replace(/^\.\//, "")).sort();
}

interface FakeRelease {
  id: number;
  tag: string;
  draft: boolean;
  assets: { id: number; name: string; data: Buffer }[];
}

/** gh on the repository o/p, whose main is at `head` and which has `releases`: it reads and changes them as GitHub does. */
function github(releases: { tag: string; draft?: boolean; files?: Record<string, Buffer | string> }[], head = "abc123") {
  let ids = 1;
  const state: FakeRelease[] = releases.map((r) => ({
    id: ids++,
    tag: r.tag,
    draft: r.draft ?? false,
    assets: Object.entries(r.files ?? {}).map(([name, data]) => ({ id: ids++, name, data: Buffer.from(data) })),
  }));
  const calls: string[][] = [];
  const published = (tag: string | undefined) => state.find((r) => r.tag === tag && !r.draft);
  const asApi = (r: FakeRelease) => ({ id: r.id, tag_name: r.tag, draft: r.draft, assets: r.assets.map(({ id, name }) => ({ id, name })) });
  const add = (r: FakeRelease | undefined, file: string) => {
    const name = path.basename(file);
    assert.ok(r, `no release for ${name}`);
    if (r.assets.some((a) => a.name === name)) throw new Error(`asset ${name} already exists`);
    r.assets.push({ id: ids++, name, data: fs.readFileSync(file) });
  };
  const gh = (args: string[]): string => {
    calls.push(args);
    const arg = (name: string) => args[args.indexOf(name) + 1] ?? "";
    if (args[0] === "api") {
      const method = args[1] === "-X" ? (args[2] ?? "") : "GET";
      const url = (method === "GET" ? args[1] : args[3]) ?? "";
      if (url === "repos/o/p/releases?per_page=100") return JSON.stringify([state.map(asApi)]);
      if (url === "repos/o/p/commits/main") return `${head}\n`;
      const tag = /^repos\/o\/p\/releases\/tags\/(.+)$/.exec(url)?.[1];
      const r = published(tag);
      if (r) return JSON.stringify(asApi(r));
      const id = Number(/\/(\d+)$/.exec(url)?.[1]);
      if (url.includes("/assets/")) {
        const of = state.find((x) => x.assets.some((a) => a.id === id));
        assert.ok(of, `no asset ${id}`);
        if (method === "DELETE") of.assets = of.assets.filter((a) => a.id !== id);
        else for (const a of of.assets) if (a.id === id) a.name = arg("-f").replace(/^name=/, "");
        return "";
      }
      if (method === "DELETE" && state.some((x) => x.id === id)) {
        state.splice(state.findIndex((x) => x.id === id), 1);
        return "";
      }
    }
    if (args[0] === "release") {
      assert.deepEqual(args.slice(-2), ["--repo", "o/p"]);
      const tag = args[2];
      if (args[1] === "download") {
        const a = published(tag)?.assets.find((x) => x.name === arg("--pattern"));
        if (!a) throw new Error("no assets match the file pattern");
        fs.writeFileSync(path.join(arg("--dir"), a.name), a.data);
        return "";
      }
      if (args[1] === "create") {
        if (published(tag)) throw new Error("a release with the same tag name already exists");
        const made: FakeRelease = { id: ids++, tag: tag ?? "", draft: false, assets: [] };
        state.push(made);
        if (args[3] && !args[3].startsWith("--")) add(made, args[3]);
        return "";
      }
      if (args[1] === "upload") {
        add(published(tag), args[3] ?? "");
        return "";
      }
    }
    throw new Error(`gh ${args.join(" ")}: not known`);
  };
  return {
    gh,
    /** The gh commands, without --repo o/p, with "<tmp>" for the temporary folder of release(). */
    commands: () => calls.map((args) => (args[0] === "release" ? args.slice(0, -2) : args).map((a) => a.replace(/^.*\/gasho-plugins-release-[^/]+/, "<tmp>"))),
    file: (tag: string, name: string) => published(tag)?.assets.find((a) => a.name === name)?.data,
    assets: (tag: string) => published(tag)?.assets.map((a) => a.name) ?? [],
  };
}

const catalogOf = (plugins: CatalogEntry[]): Catalog => ({ repo: "o/p", updatedAt: "2026-11-14T00:00:00Z", genres: genres.map(({ id, name }) => ({ id, name })), plugins });
const options = (root: string, github: { gh: (args: string[]) => string }, log: string[] = [], dry = false) => ({
  root,
  repo: "o/p",
  target: "abc123",
  branch: "main",
  dry,
  gh: github.gh,
  log: (line: string) => log.push(line),
});

test("a new version is released with the files of its dist/, and the catalog has that file's SHA-256; without GITHUB_SHA, at GitHub's default branch", () => {
  const hello: CheckedManifest = { ...manifest, description: "あいさつする" };
  const old: CheckedManifest = { ...manifest, id: "old", name: "Old", version: "1.0.0" };
  const root = repo({ hello, old });
  build(root, "hello");
  commit(root, "old-v1.0.0");
  const oldFile = tgz({ "gasho-plugin.json": JSON.stringify(old), "daemon.js": "" });
  const oldEntry = entryOf(old, { sha256: sha(oldFile), size: oldFile.length });
  const released = (): Parameters<typeof github>[0] => [
    { tag: "old-v1.0.0", files: { "old-1.0.0.tgz": oldFile } },
    { tag: "catalog", files: { "catalog.json": JSON.stringify(catalogOf([oldEntry])) } },
  ];
  const gh = github(released());
  release(options(root, gh));

  assert.deepEqual(
    gh.commands().find((c) => c[1] === "create"),
    ["release", "create", "hello-v1.2.0", "<tmp>/hello-1.2.0.tgz", "--title", "Hello 1.2.0", "--notes", "あいさつする", "--latest=false", "--target", "abc123"],
  );
  const archive = gh.file("hello-v1.2.0", "hello-1.2.0.tgz") ?? Buffer.alloc(0);
  assert.deepEqual(tgzFiles(archive), ["daemon.js", "gasho-plugin.json"]);
  const catalog = JSON.parse(gh.file("catalog", "catalog.json")?.toString() ?? "") as Catalog;
  assert.deepEqual(catalog.plugins, [entryOf(hello, { sha256: sha(archive), size: archive.length }), oldEntry]);
  assert.deepEqual(catalog.genres, catalogOf([]).genres);

  const untargeted = github(released());
  release({ ...options(root, untargeted), target: undefined });
  assert.ok(!untargeted.commands().some((c) => c.includes("--target")));
});

test("a released version is in the catalog as its file has it, with the genre named now; the old catalog.json goes once the new one is there", () => {
  const now: CheckedManifest = { ...manifest, api: "1.3", permissions: ["session.input", "session.launch"] };
  const root = repo({ hello: now });
  commit(root, "hello-v1.2.0");
  const { genre: _, ...was } = manifest;
  const file = tgz({ "gasho-plugin.json": JSON.stringify(was), "daemon.js": "" });
  const gh = github([
    { tag: "hello-v1.2.0", files: { "hello-1.2.0.tgz": file } },
    { tag: "catalog", files: { "catalog.json": JSON.stringify(catalogOf([entryOf(now, { sha256: sha(file), size: file.length })])) } },
  ]);
  const { unreleased } = release(options(root, gh));

  const entry = entryOf({ ...was, genre: "devtools" }, { sha256: sha(file), size: file.length });
  assert.deepEqual([entry.api, entry.permissions], ["1.1", ["session.input"]]);
  assert.deepEqual(gh.assets("catalog"), ["catalog.json"]);
  assert.deepEqual((JSON.parse(gh.file("catalog", "catalog.json")?.toString() ?? "") as Catalog).plugins, [entry]);
  assert.deepEqual(
    gh.commands().slice(-4).map((c) => c.slice(0, 4)),
    [
      ["release", "upload", "catalog", "<tmp>/catalog-next.json"],
      ["api", "repos/o/p/releases/tags/catalog"],
      ["api", "-X", "DELETE", "repos/o/p/releases/assets/4"],
      ["api", "-X", "PATCH", "repos/o/p/releases/assets/5"],
    ],
  );
  // Its gasho-plugin.json is not the released one (api, permissions): that change is not released.
  assert.deepEqual(unreleased, [{ folder: "hello", id: "hello", version: "1.2.0", files: ["hello/gasho-plugin.json"] }]);
});

test("a plugin changed since its version was released is named, and not released; its README.md, tests and genre do not count, but other .md and tests, which a build can take in, do", () => {
  const root = repo({ hello: manifest });
  write(root, { "hello/src/index.ts": "export {};\n" });
  commit(root, "hello-v1.2.0");
  const file = tgz({ "gasho-plugin.json": JSON.stringify({ ...manifest, genre: "integration" }), "daemon.js": "" });
  const released = [{ tag: "hello-v1.2.0", files: { "hello-1.2.0.tgz": file } }];
  write(root, { "hello/README.md": "# Hello\n", "hello/test/index.test.ts": "", "hello/src/index.test.ts": "" });
  commit(root);
  const log: string[] = [];
  assert.deepEqual(release(options(root, github(released), log, true)).unreleased, []);
  assert.equal(log[0], "hello 1.2.0: released before");

  write(root, { "hello/src/index.ts": "export const changed = true;\n", "hello/plugins/AGENTS.md": "# Agents\n", "hello/plugins/example/index.test.ts": "" });
  commit(root);
  const { unreleased } = release(options(root, github(released), [], true));
  const [changed] = unreleased;
  const files = ["hello/plugins/AGENTS.md", "hello/plugins/example/index.test.ts", "hello/src/index.ts"];
  assert.deepEqual(unreleased, [{ folder: "hello", id: "hello", version: "1.2.0", files }]);
  assert.ok(changed);
  assert.deepEqual(unreleasedWarning(changed), {
    file: "hello/gasho-plugin.json",
    message: `hello 1.2.0 is released, and 3 file(s) of hello changed since (${files.join(", ")}): they are not released until its version goes up`,
  });

  run("git", ["tag", "-d", "hello-v1.2.0"], root);
  const untagged: string[] = [];
  assert.deepEqual(release(options(root, github(released), untagged, true)).unreleased, []);
  assert.match(untagged[0] ?? "", /git has no tag hello-v1\.2\.0/);
});

test("a version older than one released already stops it, before anything is released; a dry run, only when the commit lowers it", () => {
  const root = repo({ other: { ...manifest, id: "other", name: "Other" }, hello: manifest });
  build(root, "other");
  commit(root);
  const released: Parameters<typeof github>[0] = [
    { tag: "hello-v1.10.0", files: { "hello-1.10.0.tgz": "" } },
    { tag: "hello-v1.2.0-beta.1", files: { "hello-1.2.0-beta.1.tgz": "" } },
  ];
  const gh = github(released);
  assert.throws(() => release(options(root, gh)), /hello\/gasho-plugin\.json: version 1\.2\.0 is older than 1\.10\.0, released already: give a version above it/);
  assert.deepEqual(
    gh.commands().map((c) => c[1]),
    ["repos/o/p/releases?per_page=100", "repos/o/p/commits/main"],
  );

  // A commit whose first parent has the same version: a pull request whose base is behind the releases (a run started again).
  commit(root);
  assert.deepEqual(release(options(root, github(released), [], true)).warnings, [
    { file: "hello/gasho-plugin.json", message: "hello 1.2.0 is older than 1.10.0, released after the commit this one is based on: merge main to check it again" },
  ]);
  write(root, { "hello/gasho-plugin.json": JSON.stringify({ ...manifest, version: "1.1.0" }) });
  commit(root);
  assert.throws(() => release(options(root, github(released), [], true)), /hello\/gasho-plugin\.json: version 1\.1\.0 is older than 1\.10\.0/);
});

test("a draft, or a release without its file, is not a released version: the draft goes, and the file, with LICENSE, is put in place", () => {
  const root = repo({ hello: { ...manifest, web: { js: "web.js" } }, other: { ...manifest, id: "other", name: "Other" } });
  write(root, { "hello/LICENSE": "MIT\n" });
  build(root, "hello");
  build(root, "other");
  commit(root);
  const gh = github([{ tag: "hello-v1.2.0", draft: true, files: { "hello-1.2.0.tgz": "half" } }, { tag: "other-v1.2.0" }]);
  release(options(root, gh));
  assert.deepEqual(
    gh.commands().map((c) => c.slice(0, 4)),
    [
      ["api", "repos/o/p/releases?per_page=100", "--paginate", "--slurp"],
      ["api", "repos/o/p/commits/main", "--jq", ".sha"],
      ["api", "-X", "DELETE", "repos/o/p/releases/1"],
      ["release", "create", "hello-v1.2.0", "<tmp>/hello-1.2.0.tgz"],
      ["release", "upload", "other-v1.2.0", "<tmp>/other-1.2.0.tgz"],
      ["release", "create", "catalog", "--title"],
      ["release", "upload", "catalog", "<tmp>/catalog-next.json"],
      ["api", "repos/o/p/releases/tags/catalog"],
      ["api", "-X", "PATCH", "repos/o/p/releases/assets/8"],
    ],
  );
  assert.deepEqual(tgzFiles(gh.file("hello-v1.2.0", "hello-1.2.0.tgz") ?? Buffer.alloc(0)), ["LICENSE", "daemon.js", "gasho-plugin.json", "web.js"]);
  assert.deepEqual(gh.assets("catalog"), ["catalog.json"]);
});

test("a run of a commit that main has moved on from releases nothing", () => {
  const root = repo({ hello: manifest });
  build(root, "hello");
  commit(root);
  const gh = github([], "def456");
  const log: string[] = [];
  assert.deepEqual(release(options(root, gh, log)).unreleased, []);
  assert.equal(gh.commands().length, 2);
  assert.deepEqual(log, ["main is at def456 now, not abc123: nothing is released from this older commit"]);
});

test("--dry-run reads GitHub and makes the files, and changes nothing; a plugin not built, or built without its files, stops it", () => {
  const root = repo({ hello: manifest });
  commit(root);
  const gh = github([]);
  assert.throws(() => release(options(root, gh, [], true)), /hello\/dist is not the build of hello\/gasho-plugin\.json: run npm run build first/);
  build(root, "hello");
  const log: string[] = [];
  release(options(root, gh, log, true));
  assert.deepEqual(new Set(gh.commands().map((c) => c.join(" "))), new Set(["api repos/o/p/releases?per_page=100 --paginate --slurp"]));
  assert.match(log[0] ?? "", /^hello 1\.2\.0: would release hello-1\.2\.0\.tgz \(\d+ bytes\) as hello-v1\.2\.0$/);
  assert.match(log[1] ?? "", /^catalog\.json: would be\n\{/);
  fs.rmSync(path.join(root, "hello", "dist", "daemon.js"));
  assert.throws(() => release(options(root, gh, [], true)), /hello\/dist\/gasho-plugin\.json: daemon\.js names daemon\.js, which is not there/);
});

test("a catalog-next.json left by a run that stopped is the catalog until it takes the name catalog.json; the same catalog is not uploaded again", () => {
  const root = repo({ hello: manifest });
  commit(root, "hello-v1.2.0");
  const file = tgz({ "gasho-plugin.json": JSON.stringify(manifest), "daemon.js": "" });
  const catalog = JSON.stringify(catalogOf([entryOf(manifest, { sha256: sha(file), size: file.length })]));
  const left = github([{ tag: "hello-v1.2.0", files: { "hello-1.2.0.tgz": file } }, { tag: "catalog", files: { "catalog-next.json": catalog } }]);
  release(options(root, left));
  assert.deepEqual(left.assets("catalog"), ["catalog.json"]);
  assert.deepEqual(JSON.parse(left.file("catalog", "catalog.json")?.toString() ?? "").plugins, JSON.parse(catalog).plugins);

  const same = github([{ tag: "hello-v1.2.0", files: { "hello-1.2.0.tgz": file } }, { tag: "catalog", files: { "catalog.json": catalog } }]);
  const log: string[] = [];
  release(options(root, same, log));
  assert.equal(log.at(-1), "catalog.json: no change");
  assert.ok(!same.commands().some((c) => c[1] === "upload"));
});
