import assert from "node:assert/strict";
import { test } from "node:test";
import { filesArgs, parseFiles } from "../src/daemon/ops/files.ts";
import { fileTree, folderPaths } from "../src/web/item/file-tree.ts";
import type { GitHubFile } from "../src/types.ts";

test("a file comes as added, modified, removed or renamed, with the id of its diff on GitHub's page", () => {
  const json = JSON.stringify([
    { filename: "README.md", status: "modified", additions: 1, deletions: 1 },
    { filename: "a/new.ts", status: "added", additions: 3, deletions: 0 },
    { filename: "a/copy.ts", status: "copied", previous_filename: "a/new.ts", additions: 0, deletions: 0 },
    { filename: "a/gone.ts", status: "removed", additions: 0, deletions: 9 },
    { filename: "b/moved.ts", status: "renamed", previous_filename: "a/moved.ts", additions: 2, deletions: 1 },
    { filename: "run.sh", status: "changed", additions: 0, deletions: 0 },
    { status: "added" },
  ]);
  const files = parseFiles(json);
  assert.deepEqual(
    files.map((f) => [f.path, f.status, f.previousPath]),
    [
      ["README.md", "modified", undefined],
      ["a/new.ts", "added", undefined],
      ["a/copy.ts", "added", undefined],
      ["a/gone.ts", "removed", undefined],
      ["b/moved.ts", "renamed", "a/moved.ts"],
      ["run.sh", "modified", undefined],
    ],
  );
  // As https://github.com/4rtoflow/GashoPlugins/pull/35/files names README.md's diff.
  assert.equal(files[0]?.anchor, "diff-b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5");
  const jq = filesArgs("o/r", 7, 2);
  assert.equal(jq[1], "repos/o/r/pulls/7/files?per_page=100&page=2");
  for (const field of ["filename", "status", "previous_filename", "additions", "deletions"]) assert.ok(jq.at(-1)?.includes(field), field);
});

test("folders that hold only one folder are one row, and each folder adds up what is in it", () => {
  const file = (path: string, additions: number): GitHubFile => ({ path, status: "modified", additions, deletions: 1, anchor: "" });
  const tree = fileTree([file("src/web/item/tabs/files.tsx", 5), file("src/web/item/file-tree.ts", 2), file("src/daemon/ops/files.ts", 3), file("README.md", 1)]);
  assert.deepEqual(
    tree.folders.map((d) => d.name),
    ["src"],
  );
  const src = tree.folders[0];
  assert.deepEqual(
    src?.folders.map((d) => [d.name, d.count, d.additions, d.deletions]),
    [
      ["daemon/ops", 1, 3, 1],
      ["web/item", 2, 7, 2],
    ],
  );
  assert.deepEqual(
    tree.files.map((f) => f.path),
    ["README.md"],
  );
  assert.deepEqual([tree.count, tree.additions, tree.deletions], [4, 11, 4]);
  assert.deepEqual(folderPaths(tree), ["src", "src/daemon/ops", "src/web/item", "src/web/item/tabs"]);
});
