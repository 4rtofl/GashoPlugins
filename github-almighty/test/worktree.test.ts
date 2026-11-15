import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import type { DaemonContext } from "@gasho/plugin-sdk/daemon";
import worktreeOp, { type MadeWorktree } from "../src/daemon/ops/worktree.ts";
import worktreesOp, { type Worktrees } from "../src/daemon/ops/worktrees.ts";
import { issueBranch, slug, worktreePath } from "../src/web/worktree-names.ts";
import { folderArg, inFolders, parseWorktrees, remoteOf } from "../src/daemon/worktree-git.ts";

const run = promisify(execFile);

test("a branch name takes the latin words of the title, and the folder goes beside the repository", () => {
  assert.equal(slug("Add a worktree button to Issues & PRs (github-almighty)"), "add-a-worktree-button-to");
  assert.equal(issueBranch(92, "github-almighty で、Issue・PR から worktree を作る"), "feat/92-github-almighty-issue-pr");
  assert.equal(issueBranch(5, "テーマを選べるようにする"), "feat/5-work");
  assert.equal(worktreePath("/home/me/repos/Gasho", "feat/17-x"), "/home/me/repos/Gasho-17-x");
  assert.equal(worktreePath("/home/me/repos/Gasho", "fix/a b"), "/home/me/repos/Gasho-a-b");
});

test("folders from the browser are absolute and normalized, and only inside the folders Gasho starts sessions in", () => {
  assert.equal(folderArg("/home/me/repos/x", "f"), "/home/me/repos/x");
  for (const bad of ["repos/x", "/home/me/../x", "/home/me/x/", "", 3]) assert.throws(() => folderArg(bad, "f"));
  assert.ok(inFolders("/home/me/repos/x", ["/home/me/repos"]));
  assert.ok(inFolders("/home/me/repos", ["/home/me/repos/"]));
  assert.ok(!inFolders("/home/me/repos-x", ["/home/me/repos"]));
  assert.ok(!inFolders("/etc", ["/home/me"]));
});

test("git's lists are read: worktrees with their branches, and the remote of the GitHub repository", () => {
  const porcelain = "worktree /r\nHEAD aaa\nbranch refs/heads/main\n\nworktree /r-1\nHEAD bbb\ndetached\n\nworktree /r-2\nHEAD ccc\nbranch refs/heads/feat/2-x\nprunable gitdir file points to non-existent location\n";
  assert.deepEqual(parseWorktrees(porcelain), [{ path: "/r", branch: "main" }, { path: "/r-1" }]);
  const remotes = "fork\tgit@github.com:me/Gasho.git (fetch)\nupstream\thttps://github.com/4rtoflow/Gasho.git (fetch)\n";
  assert.equal(remoteOf(remotes, "4rtoflow/gasho"), "upstream");
  assert.equal(remoteOf(remotes, "other/repo"), "origin");
});

/** A repository "upstream" on disk standing for GitHub, with main and a pull request's branch, and a clone of it. */
async function repos() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "almighty-worktree-")));
  const git = (cwd: string, ...args: string[]) => run("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args]);
  const upstream = path.join(root, "upstream");
  await fs.mkdir(upstream);
  await git(upstream, "init", "-q", "-b", "main");
  await git(upstream, "commit", "-q", "--allow-empty", "-m", "first");
  await git(upstream, "branch", "feat/3-pull");
  await git(upstream, "commit", "-q", "--allow-empty", "-m", "second");
  // A fork's pull request: GitHub keeps it only under refs/pull.
  await git(upstream, "update-ref", "refs/pull/4/head", "feat/3-pull");
  const clone = path.join(root, "repo");
  await run("git", ["clone", "-q", upstream, clone]);
  return { root, clone, git, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

function ctx(folders: string[]): DaemonContext {
  return {
    folders: () => folders,
    exec: async (command: string, args: string[]) => {
      const r = await run(command, args, { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
      return { stdout: r.stdout, stderr: r.stderr };
    },
    github: { read: async () => ({ stdout: "main\n", stderr: "" }), write: async () => ({ stdout: "", stderr: "" }) },
    log: () => {},
  } as unknown as DaemonContext;
}

test("an issue's worktree starts from the default branch, a pull request's from its head, and one is never made twice", async () => {
  const { root, clone, git, cleanup } = await repos();
  try {
    // Only the repository is trusted: its worktrees go beside it all the same.
    const c = ctx([clone]);
    const base = { repo: "o/n", repoFolder: clone };
    const issue = (await worktreeOp.run({ ...base, kind: "issues", number: 9, branch: "feat/9-x", path: `${clone}-9-x` }, c)) as MadeWorktree;
    assert.deepEqual(issue, { path: `${clone}-9-x`, branch: "feat/9-x", existed: false });
    const head = async (dir: string) => (await git(dir, "log", "-1", "--format=%s")).stdout.trim();
    assert.equal(await head(issue.path), "second");
    // Its upstream is set when it is pushed, not to main.
    await assert.rejects(git(issue.path, "rev-parse", "--abbrev-ref", "@{upstream}"));

    const again = (await worktreeOp.run({ ...base, kind: "issues", number: 9, branch: "feat/9-x", path: `${clone}-other` }, c)) as MadeWorktree;
    assert.deepEqual(again, { path: `${clone}-9-x`, branch: "feat/9-x", existed: true });

    const pull = (await worktreeOp.run({ ...base, kind: "pulls", number: 3, branch: "feat/3-pull", path: `${clone}-3-pull` }, c)) as MadeWorktree;
    assert.equal(await head(pull.path), "first");
    assert.equal((await git(pull.path, "rev-parse", "--abbrev-ref", "@{upstream}")).stdout.trim(), "origin/feat/3-pull");

    const fork = (await worktreeOp.run({ ...base, kind: "pulls", number: 4, branch: "someone-main", path: `${clone}-fork` }, c)) as MadeWorktree;
    assert.equal(await head(fork.path), "first");

    const listed = (await worktreesOp.run({ repoFolder: clone }, c)) as Worktrees;
    assert.deepEqual(
      listed.worktrees.map((w) => w.branch).sort(),
      ["feat/3-pull", "feat/9-x", "main", "someone-main"],
    );

    // A folder that is there already, and one outside the folders Gasho starts sessions in, are refused.
    await assert.rejects(worktreeOp.run({ ...base, kind: "issues", number: 10, branch: "feat/10-y", path: `${clone}-9-x` }, c), /すでにあります/);
    await assert.rejects(worktreeOp.run({ ...base, kind: "issues", number: 10, branch: "feat/10-y", path: "/tmp-elsewhere/x" }, c), /外にあります/);
    await assert.rejects(worktreesOp.run({ repoFolder: clone }, ctx(["/nowhere"])), /外にあります/);
  } finally {
    await cleanup();
  }
});
