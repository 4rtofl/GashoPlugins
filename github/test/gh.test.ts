import assert from "node:assert/strict";
import { test } from "node:test";
import { branchArg, ghError, idArg, maxAge, missingScope, repoOf } from "../src/daemon/gh.ts";
import { CallError, execError, fakeContext, loadDaemon, type FakeSession } from "../../test/daemon.ts";

const repo = (owner: string, name: string) => ({ owner, name, url: `https://github.com/${owner}/${name}` });

test("the repository's owner/name is checked before it goes to gh as --repo", () => {
  assert.equal(repoOf(repo("4rtofl", "Gasho")), "4rtofl/Gasho");
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

const daemon = await loadDaemon("github");
const session: FakeSession = { cwd: "/w/app", github: repo("o", "app"), repos: [{ path: "lib", github: repo("o", "lib") }, { path: "local" }, { path: "odd", github: repo("o", "r --web") }] };
const shown = (reason: RegExp) => (e: unknown) => e instanceof CallError && e.user && reason.test(e.message);

test("what the screen sends that gh must not get is refused with the reason, before gh runs", async () => {
  const refused: [string, unknown, RegExp][] = [
    ["runs", { repo: "elsewhere" }, /このリポジトリは見つかりません/],
    ["runs", { repo: "local" }, /GitHub にありません/],
    ["runs", { repo: "odd" }, /GitHub のものとして読めません/],
    ["runs", { repo: "x".repeat(501) }, /リポジトリの指定/],
    ["runs", { workflow: "../ci.yml" }, /ワークフローの指定/],
    ["runs", { branch: "--web" }, /ブランチの指定/],
    ["run", { id: "12a" }, /実行の番号/],
    ["project", { number: -1 }, /Project の番号/],
    ["package", { type: "npm", name: "" }, /パッケージの指定/],
    ["package", { type: "rubygems/../x", name: "a" }, /パッケージの指定/],
  ];
  for (const [method, params, reason] of refused) {
    const { ctx, calls } = fakeContext({ session });
    await assert.rejects(daemon.call(method, params, ctx), shown(reason), `${method} ${JSON.stringify(params)}`);
    assert.deepEqual(calls, []);
  }
  await assert.rejects(daemon.call("runs", {}, fakeContext().ctx), shown(/このセッションは見つかりません/));
});

test("a package read without the scope read:packages still opens, saying what to run; other failures say what went wrong", async () => {
  const noScope = execError({ stderr: "gh: You need at least read:packages scope to list packages. (HTTP 403)\n" });
  const { ctx } = fakeContext({ session, run: () => noScope });
  assert.deepEqual(await daemon.call("package", { repo: "lib", type: "npm", name: "kit" }, ctx), {
    repo: repo("o", "lib"),
    package: { type: "npm", name: "kit", visibility: "", url: "https://github.com/o/lib/packages" },
    versions: [],
    truncated: false,
    missing: { scope: "read:packages", command: "gh auth refresh -h github.com -s read:packages" },
  });
  const failed = execError({ stderr: "HTTP 502: Bad Gateway\n" });
  await assert.rejects(daemon.call("package", { type: "npm", name: "kit" }, fakeContext({ session, run: () => failed }).ctx), (e) => e instanceof CallError && e.user && e.message === ghError(failed));
  await assert.rejects(daemon.call("run", { id: 7 }, fakeContext({ session, run: () => failed }).ctx), (e) => e instanceof CallError && e.user && e.message === ghError(failed));
});
