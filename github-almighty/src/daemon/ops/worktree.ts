// Makes the worktree to work on an issue or a pull request in: { repo, kind, number, repoFolder, branch, path, base? }
// → MadeWorktree. When a worktree already has the branch, it makes none and tells which one it is. For an issue, a new
// branch starts from the base (the default branch when none is given) as GitHub has it now; for a pull request, the
// worktree takes its head branch, or, for a pull request from a fork, its commits under the head branch's name. A
// branch the repository already has is taken as it is.
import fs from "node:fs/promises";
import path from "node:path";
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh } from "../core.ts";
import { branchArg, kindArg, numberArg, repoArg } from "../gh.ts";
import type { Op } from "../op.ts";
import { allowed, folderArg, git, gitError, parseWorktrees, remoteOf, type GitCtx } from "../worktree-git.ts";

export interface MadeWorktree {
  path: string;
  branch: string;
  /** A worktree had the branch already: nothing was made. */
  existed: boolean;
}

const FETCH_MS = 45_000;

async function exists(p: string): Promise<boolean> {
  return fs.stat(p).then(
    () => true,
    () => false,
  );
}

/** Runs git, and turns its failure into git's own message. */
async function step<T>(ctx: GitCtx, what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    ctx.log(`git could not ${what}`, e);
    throw new PluginError(gitError(e));
  }
}

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const kind = kindArg(p.kind);
    const number = numberArg(p.number);
    const repoFolder = allowed(ctx, folderArg(p.repoFolder, "リポジトリのフォルダー"), "リポジトリのフォルダー");
    const branch = branchArg(p.branch);
    if (!branch) throw new PluginError("ブランチの名前を入れてください。");
    // Inside a trusted folder, or beside the repository (in its parent, which Claude Code need not trust).
    const target = allowed(ctx, folderArg(p.path, "worktree のフォルダー"), "worktree のフォルダー", [path.dirname(repoFolder)]);
    if (target === path.dirname(repoFolder)) throw new PluginError("worktree のフォルダーには、リポジトリの親のフォルダーそのものは使えません。");
    const g = git(ctx, repoFolder);

    const list = parseWorktrees((await step(ctx, "list the worktrees", () => g(["worktree", "list", "--porcelain"]))).stdout);
    const had = list.find((w) => w.branch === branch);
    if (had) return { path: had.path, branch, existed: true } satisfies MadeWorktree;
    if (await exists(target)) throw new PluginError(`${target} はすでにあります。ほかのフォルダーを指定してください。`);

    const local = await g(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).then(
      () => true,
      () => false,
    );
    if (local) {
      await step(ctx, "add the worktree", () => g(["worktree", "add", target, branch]));
      return { path: target, branch, existed: false } satisfies MadeWorktree;
    }

    const remote = remoteOf((await step(ctx, "list the remotes", () => g(["remote", "-v"]))).stdout, repo);
    if (kind === "issues") {
      const base =
        branchArg(p.base) ??
        (await gh("read the default branch", async () => (await ctx.github.read(["repo", "view", repo, "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"], { repo, maxAgeSeconds: 600 })).stdout.trim(), ctx));
      if (!base) throw new PluginError("リポジトリの既定のブランチがわかりませんでした。");
      const start = `refs/remotes/${remote}/${base}`;
      await step(ctx, `fetch ${base}`, () => g(["fetch", remote, `+refs/heads/${base}:${start}`], FETCH_MS));
      // --no-track: the new branch's upstream is set when it is first pushed, not to the base.
      await step(ctx, "add the worktree", () => g(["worktree", "add", "--no-track", "-b", branch, target, start]));
      return { path: target, branch, existed: false } satisfies MadeWorktree;
    }

    const tracking = `refs/remotes/${remote}/${branch}`;
    const sameRepo = await g(["fetch", remote, `+refs/heads/${branch}:${tracking}`], FETCH_MS).then(
      () => true,
      () => false,
    );
    if (sameRepo) {
      await step(ctx, "add the worktree", () => g(["worktree", "add", "--track", "-b", branch, target, tracking]));
    } else {
      // The head branch is not in the repository (a pull request from a fork): GitHub keeps its commits under refs/pull.
      const pull = `refs/remotes/${remote}/pull/${number}`;
      await step(ctx, `fetch #${number}`, () => g(["fetch", remote, `+refs/pull/${number}/head:${pull}`], FETCH_MS));
      await step(ctx, "add the worktree", () => g(["worktree", "add", "--no-track", "-b", branch, target, pull]));
    }
    return { path: target, branch, existed: false } satisfies MadeWorktree;
  },
} satisfies Op;
