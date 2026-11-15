import assert from "node:assert/strict";
import { test } from "node:test";
import { branchArg, ghError, idArg, maxAge, missingScope, repoOf } from "../src/daemon/gh.ts";

const repo = (owner: string, name: string) => ({ owner, name, url: `https://github.com/${owner}/${name}` });

test("the repository's owner/name is checked before it goes to gh as --repo", () => {
  assert.equal(repoOf(repo("4rtoflow", "Gasho")), "4rtoflow/Gasho");
  assert.equal(repoOf(repo("a-b", "x.y_z-1")), "a-b/x.y_z-1");
  for (const [o, n] of [["-x", "r"], ["o", "-r"], ["o/x", "r"], ["o", "r/s"], ["o", ".."], ["o", "r --web"], ["", "r"]] as const) {
    assert.throws(() => repoOf(repo(o, n)), /読めません/);
  }
});

test("ids, branches and fresh reads from the browser", () => {
  assert.equal(idArg("43632505661", "x"), 43632505661);
  assert.equal(idArg(7, "x"), 7);
  for (const bad of ["-1", "1e3", 0, 1.5, "", "12345678901234567"]) assert.throws(() => idArg(bad, "番号"), /番号が正しくありません/);
  assert.equal(branchArg("feat/97-new-github"), "feat/97-new-github");
  assert.equal(branchArg(""), undefined);
  for (const bad of ["-x", "a b", "a..b", "a~1"]) assert.throws(() => branchArg(bad));
  assert.equal(maxAge({ fresh: true }, 60), 0);
  assert.equal(maxAge({}, 60), 60);
});

test("a failed gh call is explained, with the command that adds a missing scope", () => {
  assert.match(ghError(Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" })), /GitHub CLI（gh）がありません/);
  assert.match(ghError({ stderr: "To get started with GitHub CLI, please run:  gh auth login" }), /ログインしていません/);
  assert.match(ghError({ killed: true }), /応答が遅く/);
  assert.match(ghError({ stderr: "gh: Not Found (HTTP 404)" }), /見つかりません/);
  assert.match(ghError({ stderr: "gh: You need at least read:packages scope to list packages. (HTTP 403)" }), /gh auth refresh -h github\.com -s read:packages/);
  assert.equal(missingScope({ stderr: "requires one of the following scopes: ['read:project']" })?.scope, "read:project");
  assert.equal(missingScope({ stderr: "HTTP 500" }), undefined);
  assert.match(ghError({ message: "Command failed: gh api x\nsomething else happened" }), /something else happened/);
});
