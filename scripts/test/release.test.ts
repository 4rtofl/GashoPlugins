import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { entryOf, fileOf, readPlugins, releaseOf, sameCatalog, type Manifest } from "../release.ts";

const manifest: Manifest = { id: "hello", name: "Hello", version: "1.2.0", api: "1.1", permissions: ["session.input"], daemon: { js: "daemon.js" } };

test("a plugin's release, file and catalog entry are named after its version", () => {
  assert.equal(releaseOf(manifest), "hello-v1.2.0");
  assert.equal(fileOf(manifest), "hello-1.2.0.tgz");
  assert.deepEqual(entryOf(manifest, { sha256: "ab".repeat(32), size: 10 }), {
    id: "hello",
    name: "Hello",
    version: "1.2.0",
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

test("the catalog is uploaded again only when its plugins change", () => {
  const plugins = [entryOf(manifest, { sha256: "ab".repeat(32), size: 10 })];
  const a = { repo: "o/p", updatedAt: "2026-11-14T00:00:00Z", plugins };
  assert.equal(sameCatalog(undefined, a), false);
  assert.equal(sameCatalog(a, { ...a, updatedAt: "2026-11-15T00:00:00Z" }), true);
  assert.equal(sameCatalog(a, { ...a, plugins: [{ ...plugins[0]!, version: "1.3.0" }] }), false);
});

test("the plugins are the workspaces with a gasho-plugin.json named after them", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gasho-plugins-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ workspaces: ["hello", "tools"] }));
  fs.mkdirSync(path.join(root, "hello"));
  fs.mkdirSync(path.join(root, "tools"));
  fs.writeFileSync(path.join(root, "hello", "gasho-plugin.json"), JSON.stringify(manifest));
  assert.deepEqual(readPlugins(root), [{ folder: "hello", manifest }]);
  fs.writeFileSync(path.join(root, "hello", "gasho-plugin.json"), JSON.stringify({ ...manifest, id: "other" }));
  assert.throws(() => readPlugins(root), /not the folder's name/);
  fs.writeFileSync(path.join(root, "hello", "gasho-plugin.json"), JSON.stringify({ ...manifest, version: "1.2" }));
  assert.throws(() => readPlugins(root), /not like 1\.2\.0/);
});
