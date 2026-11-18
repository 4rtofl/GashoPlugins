import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";
import { batchTargets, pageItems } from "../src/items.ts";
import { authorWords, listArgs, namesArgs, ownWanted, parseList, parseNames, requestedQuery, SEARCH_LIMIT, upperSearches, watchedQueries } from "../src/daemon/gh.ts";
import { createWorktree, projectFiles, prWorktree, readClone, removeWorktree, repoName, ReviewError, reviewName, reviewNumbers, type Clone, type Exec, type OnGitHub } from "../src/daemon/git.ts";
import { Reviewer, type GitHubRead } from "../src/daemon/reviewer.ts";
import { fillTemplate, parseTemplates } from "../src/template.ts";
import type { Listing, PrRow } from "../src/types.ts";

const run = promisify(execFile);

const roots: string[] = [];
after(() => Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true }))));

/** ctx.exec as gasho-daemon gives it: no prompts. */
const exec: Exec = async (command, args, o = {}) => {
  const { stdout, stderr } = await run(command, args, {
    cwd: o.cwd,
    timeout: o.timeoutMs ?? 30_000,
    maxBuffer: o.maxBuffer ?? 8 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...o.env },
  });
  return { stdout, stderr };
};

const git = async (cwd: string, ...args: string[]) =>
  (await run("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "init.defaultBranch=main", ...args])).stdout.trim();

/**
 * A repository "o/r" with a bare origin, branches feat/5-a and feat/6-b, pull requests #7 and #8 from forks
 * (refs/pull/<N>/head) and a clone at <root>/r/main. `onGitHub` says whether origin has a commit, as GitHub keeps one a
 * force-push left behind.
 */
async function setup(): Promise<{ root: string; primary: string; clone: () => Promise<Clone>; sha: (ref: string) => Promise<string>; onGitHub: OnGitHub }> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "github-review-")));
  roots.push(root);
  const origin = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  await run("git", ["init", "--bare", "-b", "main", origin]);
  await run("git", ["clone", origin, seed]);
  const commit = async (msg: string) => {
    await fs.writeFile(path.join(seed, "f.txt"), `${msg}\n`);
    await git(seed, "add", ".");
    await git(seed, "commit", "-m", msg);
  };
  await commit("base");
  await git(seed, "push", "origin", "HEAD:main");
  for (const b of ["feat/5-a", "feat/6-b"]) {
    await git(seed, "checkout", "-b", b, "main");
    await commit(b);
    await git(seed, "push", "origin", b);
  }
  for (const n of [7, 8]) {
    await git(seed, "checkout", "-b", `fork-${n}`, "main");
    await commit(`from fork ${n}`);
    await git(seed, "push", "origin", `HEAD:refs/pull/${n}/head`);
  }
  const primary = path.join(root, "r", "main");
  await fs.mkdir(path.dirname(primary));
  await run("git", ["clone", origin, primary]);
  return {
    root,
    primary,
    clone: () => readClone(exec, { path: primary, github: "o/r" }),
    sha: (ref) => git(origin, "rev-parse", ref),
    onGitHub: (oid) => git(origin, "cat-file", "-e", `${oid}^{commit}`).then(() => true, () => false),
  };
}

test("worktree: a pull request of the repository gets review-<repository>-<number> on a local branch that tracks origin's, and is found the next time", async () => {
  const s = await setup();
  const made = await createWorktree(exec, await s.clone(), { number: 5, branch: "feat/5-a", fork: false });
  const dest = path.join(s.root, "r", "review-r-5");
  assert.deepEqual(made, { path: dest, created: true, branch: "feat/5-a" });
  assert.equal(await git(dest, "rev-parse", "--abbrev-ref", "@{upstream}"), "origin/feat/5-a");
  assert.equal(await git(dest, "rev-parse", "HEAD"), await s.sha("feat/5-a"));
  assert.deepEqual(await createWorktree(exec, await s.clone(), { number: 5, branch: "feat/5-a", fork: false }), { path: dest, created: false, branch: "feat/5-a" });
});

test("worktree: a pull request from a fork is checked out at its head, detached, though another fetch writes FETCH_HEAD meanwhile; a folder of that name that is no worktree is left alone", async () => {
  const s = await setup();
  // Another pull request's worktree being made in the same clone, or an editor's fetch, right after this one's.
  const racing: Exec = async (command, args, o) => {
    const out = await exec(command, args, o);
    if (args.includes("fetch") && args.includes("refs/pull/7/head")) await git(s.primary, "fetch", "origin", "refs/pull/8/head");
    return out;
  };
  const made = await createWorktree(racing, await s.clone(), { number: 7, branch: "main", fork: true, head: await s.sha("refs/pull/7/head") });
  const dest = path.join(s.root, "r", "review-r-7");
  assert.deepEqual(made, { path: dest, created: true });
  assert.equal(await git(dest, "rev-parse", "HEAD"), await s.sha("refs/pull/7/head"));
  assert.equal(await git(dest, "branch", "--show-current"), "");
  // A head the fetch does not bring (pushed over after GitHub was read) makes nothing.
  await assert.rejects(createWorktree(exec, await s.clone(), { number: 8, branch: "main", fork: true, head: "1".repeat(40) }), (e: unknown) => e instanceof ReviewError && /読んだあとに変わりました/.test(e.message));
  await assert.rejects(fs.lstat(path.join(s.root, "r", "review-r-8")));
  // The fork's branch is "main", which says nothing of the primary checkout on main.
  assert.equal(prWorktree(await s.clone(), { number: 8, branch: "main", fork: true }), undefined);

  // What Claude Code would read there, before a session starts in the fork's code.
  assert.deepEqual(await projectFiles(await s.clone(), 7), { path: dest, files: [] });
  await fs.mkdir(path.join(dest, ".claude"));
  await fs.writeFile(path.join(dest, ".mcp.json"), "{}");
  assert.deepEqual(await projectFiles(await s.clone(), 7), { path: dest, files: [".claude/", ".mcp.json"] });
  await assert.rejects(projectFiles(await s.clone(), 8), (e: unknown) => e instanceof ReviewError && /review-r-8/.test(e.message));

  await fs.mkdir(path.join(s.root, "r", "review-r-9"));
  await assert.rejects(createWorktree(exec, await s.clone(), { number: 9, branch: "feat/6-b", fork: false }), (e: unknown) => e instanceof ReviewError && /がもうあります/.test(e.message));
});

test("worktree: a local branch of the pull request's name is moved up to origin's, unless it has commits origin lacks", async () => {
  const s = await setup();
  await git(s.primary, "branch", "feat/6-b", "origin/main");
  const made = await createWorktree(exec, await s.clone(), { number: 6, branch: "feat/6-b", fork: false });
  assert.equal(await git(made.path, "rev-parse", "HEAD"), await s.sha("feat/6-b"));
  assert.equal(await git(made.path, "rev-parse", "--abbrev-ref", "@{upstream}"), "origin/feat/6-b");

  await git(s.primary, "fetch", "origin", "feat/5-a:feat/5-a");
  await git(s.primary, "checkout", "feat/5-a");
  await fs.writeFile(path.join(s.primary, "g.txt"), "mine\n");
  await git(s.primary, "add", ".");
  await git(s.primary, "commit", "-m", "mine");
  await git(s.primary, "checkout", "main");
  await assert.rejects(createWorktree(exec, await s.clone(), { number: 5, branch: "feat/5-a", fork: false }), (e: unknown) => e instanceof ReviewError && /origin に無い commit/.test(e.message));
  await assert.rejects(fs.lstat(path.join(s.root, "r", "review-r-5")));
});

test("remove: not while something would be lost; then the worktree and its local branch go, and a merged branch gone from origin counts as pushed", async () => {
  const s = await setup();
  const pr = { number: 5, branch: "feat/5-a", fork: false };
  const { path: dest } = await createWorktree(exec, await s.clone(), pr);

  await fs.writeFile(path.join(dest, "new.txt"), "draft\n");
  await assert.rejects(removeWorktree(exec, await s.clone(), pr), (e: unknown) => e instanceof ReviewError && /未コミットの変更が 1 件/.test(e.message));
  await git(dest, "add", ".");
  await git(dest, "commit", "-m", "fix");
  await assert.rejects(removeWorktree(exec, await s.clone(), pr), (e: unknown) => e instanceof ReviewError && /push していない commit が 1 個/.test(e.message));
  await git(dest, "push", "origin", "HEAD:feat/5-a");

  // Merged and deleted on GitHub, and pruned here: only the pull request's head says the reviewer's commit was pushed
  // (the one the worktree was made at counts as pushed).
  const head = await s.sha("feat/5-a");
  await git(s.root, "--git-dir", path.join(s.root, "origin.git"), "branch", "-D", "feat/5-a");
  await git(s.primary, "fetch", "--prune", "origin");
  await assert.rejects(removeWorktree(exec, await s.clone(), pr, { onGitHub: s.onGitHub }), (e: unknown) => e instanceof ReviewError && /push していない commit が 1 個/.test(e.message));
  assert.deepEqual(await removeWorktree(exec, await s.clone(), { ...pr, head }), { path: dest, branch: "feat/5-a" });
  await assert.rejects(fs.lstat(dest));
  assert.equal(await git(s.primary, "branch", "--list", "feat/5-a"), "");

  // A fork's pull request whose worktree the reviewer moved to a later head, and that got a commit after that: the new
  // head is fetched, and the commits before it count as pushed.
  const old = await s.sha("refs/pull/7/head");
  const fork = { number: 7, branch: "main", fork: true, head: old };
  const { path: forkDest } = await createWorktree(exec, await s.clone(), fork);
  const origin = path.join(s.root, "origin.git");
  const push = async (parent: string) => {
    const oid = await git(origin, "commit-tree", await s.sha(`${old}^{tree}`), "-p", parent, "-m", "more from the fork");
    await git(origin, "update-ref", "refs/pull/7/head", oid);
    return oid;
  };
  await git(forkDest, "fetch", "origin", await push(old));
  await git(forkDest, "checkout", "--detach", "FETCH_HEAD");
  const next = await push(await s.sha("refs/pull/7/head"));
  await git(s.primary, "remote", "set-url", "origin", path.join(s.root, "nowhere.git"));
  await assert.rejects(removeWorktree(exec, await s.clone(), { ...fork, head: next }), (e: unknown) => e instanceof ReviewError && /head を取ってこられなかった/.test(e.message));
  await git(s.primary, "remote", "set-url", "origin", origin);
  assert.deepEqual(await removeWorktree(exec, await s.clone(), { ...fork, head: next }), { path: forkDest });

  // Only review worktrees are removed: a worktree of the branch made by hand only opens.
  await git(s.primary, "worktree", "add", path.join(s.root, "r", "issue-6"), "-b", "feat/6-b", "origin/feat/6-b");
  assert.deepEqual(prWorktree(await s.clone(), { number: 6, branch: "feat/6-b" }), { path: path.join(s.root, "r", "issue-6"), branch: "feat/6-b", review: false });
  await assert.rejects(removeWorktree(exec, await s.clone(), { number: 6, branch: "feat/6-b", fork: false }), ReviewError);
  // A merge asked to clean it up removes it, whatever its name.
  const handmade = { number: 6, branch: "feat/6-b", fork: false, head: await s.sha("feat/6-b") };
  assert.deepEqual(await removeWorktree(exec, await s.clone(), handmade, { anyName: true }), { path: path.join(s.root, "r", "issue-6"), branch: "feat/6-b" });
  // The primary checkout never goes, even on the pull request's branch.
  await git(s.primary, "checkout", "-b", "feat/10-c");
  await assert.rejects(removeWorktree(exec, await s.clone(), { number: 10, branch: "feat/10-c", fork: false }, { anyName: true }), ReviewError);
  await fs.access(s.primary);
});

test("remove: after its author rebased and force-pushed, the commit the worktree was made at counts as pushed, and the reviewer's own commits still do not", async () => {
  const s = await setup();
  const origin = path.join(s.root, "origin.git");
  const rebase = async (ref: string) => {
    const old = await s.sha(ref);
    const next = await git(origin, "commit-tree", await s.sha(`${old}^{tree}`), "-p", await s.sha("main"), "-m", "rebased");
    await git(origin, "update-ref", ref, next);
    return next;
  };

  const fork = { number: 7, branch: "main", fork: true, head: await s.sha("refs/pull/7/head") };
  const { path: forkDest } = await createWorktree(exec, await s.clone(), fork);
  const next = await rebase("refs/pull/7/head");
  await fs.writeFile(path.join(forkDest, "review.txt"), "mine\n");
  await git(forkDest, "add", ".");
  await git(forkDest, "commit", "-m", "mine");
  await assert.rejects(removeWorktree(exec, await s.clone(), { ...fork, head: next }, { onGitHub: s.onGitHub }), (e: unknown) => e instanceof ReviewError && /push していない commit が 1 個/.test(e.message));
  await git(forkDest, "reset", "--hard", "HEAD~1");
  // GitHub has to be read for that: when it cannot be, nothing goes.
  const unread: OnGitHub = () => Promise.reject(new Error("GitHub に届きません"));
  await assert.rejects(removeWorktree(exec, await s.clone(), { ...fork, head: next }, { onGitHub: unread }), (e: unknown) => e instanceof ReviewError && /GitHub を読めなかった.*1 個.*GitHub に届きません/.test(e.message));
  assert.deepEqual(await removeWorktree(exec, await s.clone(), { ...fork, head: next }, { onGitHub: s.onGitHub }), { path: forkDest });

  // Of the same repository, with origin's branch fetched after the force-push.
  const pr = { number: 6, branch: "feat/6-b", fork: false };
  const { path: dest } = await createWorktree(exec, await s.clone(), pr);
  const head = await rebase("refs/heads/feat/6-b");
  await git(s.primary, "fetch", "origin");
  assert.deepEqual(await removeWorktree(exec, await s.clone(), { ...pr, head }, { onGitHub: s.onGitHub }), { path: dest, branch: "feat/6-b" });

  // The reviewer's commit, pushed and then force-pushed away, is on GitHub too; once the reflog lost its older entries,
  // the first one left is that commit, which does not count as the one the worktree was made at.
  const again = await createWorktree(exec, await s.clone(), pr);
  await fs.writeFile(path.join(again.path, "review.txt"), "mine\n");
  await git(again.path, "add", ".");
  await git(again.path, "commit", "-m", "mine");
  await git(again.path, "push", "origin", "HEAD:feat/6-b");
  const dropped = await rebase("refs/heads/feat/6-b");
  await git(s.primary, "fetch", "origin");
  for (const entry of (await git(again.path, "reflog", "--format=%gd")).split("\n").slice(1).reverse()) await git(again.path, "reflog", "delete", entry);
  await assert.rejects(removeWorktree(exec, await s.clone(), { ...pr, head: dropped }, { onGitHub: s.onGitHub }), (e: unknown) => e instanceof ReviewError && /push していない commit が 2 個/.test(e.message));

  // A review worktree made by hand on a commit never pushed: GitHub does not have the one it was made at.
  await git(s.primary, "switch", "-c", "wip");
  await fs.writeFile(path.join(s.primary, "wip.txt"), "wip\n");
  await git(s.primary, "add", ".");
  await git(s.primary, "commit", "-m", "wip");
  await git(s.primary, "switch", "main");
  const handmade = path.join(s.root, "r", "review-5");
  await git(s.primary, "worktree", "add", handmade, "wip");
  await assert.rejects(removeWorktree(exec, await s.clone(), { number: 5, branch: "feat/5-a", fork: false, head: await s.sha("feat/5-a") }, { onGitHub: s.onGitHub }), (e: unknown) => e instanceof ReviewError && /push していない commit が 1 個/.test(e.message));
  assert.match(await git(s.primary, "branch", "--list", "wip"), /wip/);
});

test("worktree: a review worktree whose folder is gone does not open, and is made again or removed, unless that would lose a commit", async () => {
  const s = await setup();
  const fork = async (number: number) => ({ number, branch: "main", fork: true, head: await s.sha(`refs/pull/${number}/head`) });
  const pr7 = await fork(7);
  const { path: dest } = await createWorktree(exec, await s.clone(), pr7);
  await fs.rm(dest, { recursive: true });
  assert.deepEqual(prWorktree(await s.clone(), pr7), { path: dest, review: true, missing: true });
  assert.deepEqual(await createWorktree(exec, await s.clone(), pr7), { path: dest, created: true });
  assert.equal(await git(dest, "rev-parse", "HEAD"), pr7.head);
  // Its HEAD and reflog are read in the primary checkout then: after a force-push, the commit it was made at counts.
  await fs.rm(dest, { recursive: true });
  const origin = path.join(s.root, "origin.git");
  const rebased = await git(origin, "commit-tree", await s.sha(`${pr7.head}^{tree}`), "-p", await s.sha("main"), "-m", "rebased");
  await git(origin, "update-ref", "refs/pull/7/head", rebased);
  await assert.rejects(removeWorktree(exec, await s.clone(), { ...pr7, head: rebased }), (e: unknown) => e instanceof ReviewError && /push していない commit が 1 個/.test(e.message));
  assert.deepEqual(await removeWorktree(exec, await s.clone(), { ...pr7, head: rebased }, { onGitHub: s.onGitHub }), { path: dest });

  // A commit made in it is only on its HEAD, which git forgets with it.
  const pr8 = await fork(8);
  const { path: dest8 } = await createWorktree(exec, await s.clone(), pr8);
  await fs.writeFile(path.join(dest8, "review.txt"), "mine\n");
  await git(dest8, "add", ".");
  await git(dest8, "commit", "-m", "mine");
  await fs.rm(dest8, { recursive: true });
  await assert.rejects(createWorktree(exec, await s.clone(), pr8), (e: unknown) => e instanceof ReviewError && /作り直しません.*push していない commit が 1 個/.test(e.message));
  await assert.rejects(removeWorktree(exec, await s.clone(), pr8), (e: unknown) => e instanceof ReviewError && /push していない commit が 1 個/.test(e.message));

  const pr = { number: 5, branch: "feat/5-a", fork: false };
  const { path: dest5 } = await createWorktree(exec, await s.clone(), pr);
  await fs.rm(dest5, { recursive: true });
  assert.deepEqual(await removeWorktree(exec, await s.clone(), pr), { path: dest5, branch: "feat/5-a" });
  assert.equal(await git(s.primary, "branch", "--list", "feat/5-a"), "");
  assert.doesNotMatch(await git(s.primary, "worktree", "list"), /review-r-5/);

  // A merged pull request whose branch went from origin is not made again, and keeps what git has of it.
  const pr6 = { number: 6, branch: "feat/6-b", fork: false };
  const { path: dest6 } = await createWorktree(exec, await s.clone(), pr6);
  await fs.rm(dest6, { recursive: true });
  await git(origin, "branch", "-D", "feat/6-b");
  await assert.rejects(createWorktree(exec, await s.clone(), pr6), (e: unknown) => e instanceof ReviewError && /origin の feat\/6-b を取ってくること/.test(e.message));
  assert.deepEqual(prWorktree(await s.clone(), pr6), { path: dest6, branch: "feat/6-b", review: true, missing: true });
});

test("worktree: the name holds REPO of OWNER/REPO, kept to what a folder name can safely have", () => {
  assert.equal(reviewName("4rtofl/GashoPlugins", 158), "review-GashoPlugins-158");
  assert.equal(reviewName("o/my.repo_x-2", 3), "review-my.repo_x-2-3");
  assert.equal(repoName("o/.github"), "github");
  assert.equal(repoName("o/a b/../c"), "c");
  assert.equal(reviewName("o/", 4), "review-4");
});

test("worktree: review worktrees by either name are found, numbered, and removed; folders that only look like one are not", async () => {
  const s = await setup();
  const at = (name: string) => path.join(s.root, "r", name);
  // review-5 from before the name held the repository's; review-r-7 now.
  await git(s.primary, "worktree", "add", "--track", "-b", "feat/5-a", at("review-5"), "origin/feat/5-a");
  await createWorktree(exec, await s.clone(), { number: 7, branch: "main", fork: true, head: await s.sha("refs/pull/7/head") });
  // Not review worktrees: another repository's name, a number of no pull request, and one in another folder.
  await git(s.primary, "worktree", "add", "--detach", at("review-other-8"), "HEAD");
  await git(s.primary, "worktree", "add", "--detach", at("review-r-x"), "HEAD");
  await fs.mkdir(path.join(s.root, "elsewhere"));
  await git(s.primary, "worktree", "add", "--detach", path.join(s.root, "elsewhere", "review-r-9"), "HEAD");
  assert.deepEqual(reviewNumbers(await s.clone()).sort((a, b) => a - b), [5, 7]);

  const old = { number: 5, branch: "feat/5-a", fork: false };
  assert.deepEqual(prWorktree(await s.clone(), old), { path: at("review-5"), branch: "feat/5-a", review: true });
  // The one from before is used, not made again under the new name.
  assert.deepEqual(await createWorktree(exec, await s.clone(), old), { path: at("review-5"), created: false, branch: "feat/5-a" });
  await assert.rejects(fs.lstat(at("review-r-5")));
  assert.deepEqual(await removeWorktree(exec, await s.clone(), { ...old, head: await s.sha("feat/5-a") }), { path: at("review-5"), branch: "feat/5-a" });
  assert.equal(prWorktree(await s.clone(), { number: 8, branch: "main", fork: true }), undefined);
  await assert.rejects(removeWorktree(exec, await s.clone(), { number: 8, branch: "main", fork: true }), (e: unknown) => e instanceof ReviewError && /review-r-8/.test(e.message));
});

test("gh: the watched repositories are split into searches GitHub takes, each with the search words and the newest first", () => {
  const repos = Array.from({ length: 30 }, (_, i) => `some-owner/repository-${i}`);
  const qs = watchedQueries(repos, "label:bug");
  assert.ok(qs.length > 1);
  for (const q of qs) {
    assert.ok(q.length <= 256, q);
    assert.match(q, /^is:pr repo:.* label:bug sort:created-desc$/);
  }
  assert.deepEqual(qs.flatMap((q) => [...q.matchAll(/repo:(\S+)/g)].map((m) => m[1])), repos);
  assert.equal(requestedQuery("is:open sort:updated-desc"), "is:pr review-requested:@me archived:false is:open sort:updated-desc");
  assert.deepEqual(watchedQueries([], "is:open"), []);
});

test("gh: each part of the answer comes back to its part of the query, with what GitHub could not answer", () => {
  const lookups = [{ repo: "o/r", numbers: [12, 99] }];
  const args = listArgs({ ...upperSearches(""), watched: ["is:pr repo:o/r", "is:pr repo:o/s"], lookups });
  const query = args[args.indexOf("-f") + 1] ?? "";
  assert.match(query, /req: search\(query: \$req/);
  assert.match(query, /own: search\(query: \$own, type: ISSUE, first: 50\)/);
  assert.match(query, /both: search\(query: \$both, type: ISSUE, first: 0\) \{ issueCount \}/);
  assert.match(query, /viewer \{ login \}/);
  assert.match(query, /w1: search\(query: \$w1/);
  assert.match(query, /l0: repository\(owner: \$o0, name: \$n0\) \{ p12: pullRequest\(number: 12\)/);
  assert.ok(args.includes("w1=is:pr repo:o/s") && args.includes("o0=o") && args.includes("n0=r"));

  const pr = (repo: string, number: number, over: Record<string, unknown> = {}) => ({
    number,
    title: `t${number}`,
    url: `https://github.com/${repo}/pull/${number}`,
    state: "OPEN",
    headRefName: `feat/${number}`,
    repository: { nameWithOwner: repo },
    labels: { nodes: [{ name: "bug", color: "d73a4a" }] },
    statusCheckRollup: { state: "ERROR" },
    ...over,
  });
  const answer = parseList(
    JSON.stringify({
      data: {
        req: { issueCount: 3, nodes: [pr("x/y", 1, { isCrossRepository: true, reviewDecision: "CHANGES_REQUESTED" }), {}] },
        w0: { issueCount: 1, nodes: [pr("o/r", 2, { isDraft: true })] },
        w1: null,
        l0: { p12: pr("o/r", 12, { state: "MERGED" }), p99: null },
      },
      errors: [{ message: "Could not resolve to a PullRequest with the number of 99." }],
    }),
    { watched: 2, lookups },
  );
  assert.deepEqual(
    answer.requested.prs.map((p) => [p.repo, p.number, p.fork, p.review, p.checks, p.labels]),
    [["x/y", 1, true, "changes_requested", "failure", [{ name: "bug", color: "d73a4a" }]]],
  );
  assert.equal(answer.requested.more, 1);
  assert.deepEqual(
    answer.watched.map((w) => w.prs.map((p) => [p.number, p.draft])),
    [[[2, true]], []],
  );
  assert.deepEqual(
    answer.lookups.map((l) => l.map((p) => [p.number, p.state])),
    [[[12, "merged"]]],
  );
  assert.deepEqual(answer.errors, ["Could not resolve to a PullRequest with the number of 99."]);
});

/** A pull request of the upper part as GitHub answers it. */
const upperPr = <T extends Record<string, unknown>>(number: number, over: T = {} as T) => ({
  number,
  title: `t${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  state: "OPEN",
  headRefName: `feat/${number}`,
  repository: { nameWithOwner: "o/r" },
  createdAt: `2026-11-${String(number).padStart(2, "0")}T00:00:00Z`,
  ...over,
});
const upper = (data: Record<string, unknown>, words = "") => parseList(JSON.stringify({ data: { viewer: { login: "Me" }, ...data } }), { watched: 0, lookups: [], words }).requested;
const numbers = (r: { prs: { number: number }[] }) => r.prs.map((p) => p.number);

test("gh: the upper part searches for mine with the search words, in the one query", () => {
  assert.deepEqual(upperSearches("is:open label:bug"), {
    requested: "is:pr review-requested:@me archived:false is:open label:bug sort:created-desc",
    own: "is:pr author:@me archived:false is:open label:bug sort:created-desc",
    both: "is:pr author:@me review-requested:@me archived:false is:open label:bug",
  });
  assert.equal(upperSearches("sort:updated-asc").own, "is:pr author:@me archived:false sort:updated-asc");
  const args = listArgs({ ...upperSearches("is:open"), watched: [], lookups: [] });
  assert.equal(args.filter((a) => a === "graphql").length, 1);
  assert.ok(args.includes("own=is:pr author:@me archived:false is:open sort:created-desc"));
});

test("gh: the words about the author stay out of the search of mine, which GitHub would widen or undo with them", () => {
  assert.deepEqual(authorWords('is:open author:octocat -author:"Hubot" "author:phrase" author: AUTHOR:x'), {
    rest: 'is:open "author:phrase" author: AUTHOR:x',
    only: ["octocat"],
    not: ["hubot"],
  });
  const { requested, own, both } = upperSearches("is:open author:octocat -author:hubot");
  assert.equal(requested, "is:pr review-requested:@me archived:false is:open author:octocat -author:hubot sort:created-desc");
  assert.equal(own, "is:pr author:@me archived:false is:open sort:created-desc");
  assert.equal(both, "is:pr author:@me review-requested:@me archived:false is:open");
});

test("gh: mine are shown as the words about the author say", () => {
  for (const words of ["", "is:open", "author:@me", "author:@ME", "author:me", 'author:"ME"', "author:octocat author:me", "-author:octocat", "author:me -author:octocat", '"author:octocat"', "author:", "AUTHOR:octocat"]) {
    assert.equal(ownWanted(words, "Me"), true, words);
  }
  for (const words of ["author:octocat", "author:octocat -author:me", "-author:@me", "-author:me", "author:@me -author:@me", 'author:""']) {
    assert.equal(ownWanted(words, "Me"), false, words);
  }
  // Without the answer of who I am, only @me is known to be me.
  assert.equal(ownWanted("author:me", undefined), false);
  assert.equal(ownWanted("author:@me", undefined), true);
});

test("gh: the upper part shows a pull request both searches found once, and leaves mine out when the words do", () => {
  const data = {
    req: { issueCount: 2, nodes: [upperPr(3), upperPr(1)] },
    own: { issueCount: 2, nodes: [upperPr(3), upperPr(2)] },
    both: { issueCount: 1 },
  };
  const all = upper(data);
  assert.deepEqual(numbers(all), [3, 2, 1]);
  assert.equal(all.more, 0);
  const others = upper(data, "author:octocat");
  assert.deepEqual(numbers(others), [3, 1]);
  assert.equal(others.more, 0);
});

test("gh: the upper part is in the order of the first sort: of the words, the newest first without one", () => {
  const a = upperPr(1, { updatedAt: "2026-11-10T00:00:00Z", totalCommentsCount: 5, reactions: { totalCount: 0 }, reactionGroups: [{ content: "HEART", reactors: { totalCount: 1 } }] });
  const b = upperPr(2, { updatedAt: "2026-11-30T00:00:00Z", totalCommentsCount: 1, reactions: { totalCount: 9 }, reactionGroups: [{ content: "HEART", reactors: { totalCount: 3 } }] });
  const c = upperPr(3, { updatedAt: "2026-11-20T00:00:00Z", totalCommentsCount: 3, reactions: { totalCount: 1 }, reactionGroups: [{ content: "THUMBS_UP", reactors: { totalCount: 1 } }] });
  const sortedBy = (words: string, key: (x: typeof a) => number) => {
    const list = (xs: (typeof a)[]) => ({ issueCount: xs.length, nodes: [...xs].sort((x, y) => key(x) - key(y)) });
    return numbers(upper({ req: list([a, c]), own: list([b]) }, words));
  };
  const time = (v: unknown) => Date.parse(String(v));
  assert.deepEqual(sortedBy("", (x) => -time(x.createdAt)), [3, 2, 1]);
  assert.deepEqual(sortedBy("sort:nonsense", (x) => -time(x.createdAt)), [3, 2, 1]);
  assert.deepEqual(sortedBy("sort:created-asc", (x) => time(x.createdAt)), [1, 2, 3]);
  assert.deepEqual(sortedBy("sort:CREATED-ASC", (x) => time(x.createdAt)), [1, 2, 3]);
  assert.deepEqual(sortedBy("sort:updated", (x) => -time(x.updatedAt)), [2, 3, 1]);
  assert.deepEqual(sortedBy("sort:updated-asc sort:created-desc", (x) => time(x.updatedAt)), [1, 3, 2]);
  assert.deepEqual(sortedBy("sort:comments-desc", (x) => -x.totalCommentsCount), [1, 3, 2]);
  assert.deepEqual(sortedBy("sort:reactions-desc", (x) => -x.reactions.totalCount), [2, 3, 1]);
  assert.deepEqual(sortedBy("sort:interactions-desc", (x) => -(x.totalCommentsCount + x.reactions.totalCount)), [2, 1, 3]);
  const hearts = (x: typeof a) => x.reactionGroups.find((g) => g.content === "HEART")?.reactors.totalCount ?? 0;
  assert.deepEqual(sortedBy("sort:reactions-heart-desc", (x) => -hearts(x)), [2, 1, 3]);
});

test("gh: the upper part stops at the limit of one search and counts the rest of the two once", () => {
  const nodes = (from: number, n: number) => Array.from({ length: n }, (_, i) => upperPr(from - i, { createdAt: new Date(Date.UTC(2026, 0, 1) + (from - i) * 60_000).toISOString() }));
  // 40 + 30 read, 5 of them in both: 65 in all, 50 shown.
  const asked = nodes(200, 40);
  const mine = [...asked.slice(0, 5), ...nodes(100, 25)];
  const some = upper({ req: { issueCount: 40, nodes: asked }, own: { issueCount: 30, nodes: mine }, both: { issueCount: 5 } });
  assert.equal(some.prs.length, SEARCH_LIMIT);
  assert.equal(new Set(numbers(some)).size, SEARCH_LIMIT);
  assert.deepEqual(numbers(some).slice(38, 42), [162, 161, 100, 99]);
  assert.equal(some.more, 15);

  // GitHub found more than either search reads: those not read count too.
  const many = upper({ req: { issueCount: 120, nodes: nodes(400, 50) }, own: { issueCount: 80, nodes: nodes(300, 50) }, both: { issueCount: 10 } });
  assert.equal(many.prs.length, SEARCH_LIMIT);
  assert.equal(many.more, 140);

  // Exactly the limit: nothing more to say.
  const full = upper({ req: { issueCount: 30, nodes: nodes(200, 30) }, own: { issueCount: 20, nodes: nodes(100, 20) }, both: { issueCount: 0 } });
  assert.equal(full.prs.length, SEARCH_LIMIT);
  assert.equal(full.more, 0);

  // Mine left out by the words do not count.
  const others = upper({ req: { issueCount: 60, nodes: nodes(200, 50) }, own: { issueCount: 500, nodes: nodes(100, 50) }, both: { issueCount: 3 } }, "author:octocat");
  assert.equal(others.prs.length, SEARCH_LIMIT);
  assert.equal(others.more, 10);

  // GitHub could not count those in both: the ones it read are still counted once.
  const uncounted = upper({ req: { issueCount: 2, nodes: [upperPr(2), upperPr(1)] }, own: { issueCount: 2, nodes: [upperPr(2), upperPr(1)] }, both: null });
  assert.deepEqual(numbers(uncounted), [2, 1]);
  assert.equal(uncounted.more, 0);

  // One search GitHub could not answer leaves the other's.
  const half = upper({ req: null, own: { issueCount: 1, nodes: [upperPr(1)] } });
  assert.deepEqual(numbers(half), [1]);
});

test("list: my own pull request comes in the upper part once with where it is here; one without a clone here is left out of the page", async () => {
  const s = await setup();
  const file = path.join(s.root, "watched.json");
  const github: GitHubRead = async (args) => {
    const query = args[args.indexOf("-f") + 1] ?? "";
    if (!query.includes("search(")) return { stdout: JSON.stringify({ data: { r0: { nameWithOwner: "o/r" } } }) };
    const mine = (n: number, repo = "o/r") => upperPr(n, { viewerDidAuthor: true, repository: { nameWithOwner: repo }, url: `https://github.com/${repo}/pull/${n}` });
    return {
      stdout: JSON.stringify({
        data: {
          viewer: { login: "me" },
          req: { issueCount: 2, nodes: [upperPr(4), mine(3)] },
          own: { issueCount: 2, nodes: [mine(3), mine(2, "x/no-clone")] },
          both: { issueCount: 1 },
        },
      }),
    };
  };
  const origin = await git(s.primary, "remote", "get-url", "origin");
  await git(s.primary, "remote", "set-url", "origin", "https://github.com/o/r.git");
  const reviewer = new Reviewer({ exec, folders: () => [s.primary], file, log: () => {} });
  const listing = await reviewer.list(github, "is:open", false);
  await git(s.primary, "remote", "set-url", "origin", origin);
  assert.deepEqual(listing.requested.map((p) => [p.repo, p.number, p.own, p.place?.primary]), [
    ["o/r", 4, undefined, s.primary],
    ["o/r", 3, true, s.primary],
    ["x/no-clone", 2, true, undefined],
  ]);
  assert.equal(listing.requestedMore, undefined);
  assert.deepEqual(pageItems([{ machine: "m", listing }]).requested.map((i) => i.pr.number), [4, 3]);
});

test("gh: the names GitHub has now come back by the name each repository was asked with; one GitHub does not find has none", () => {
  const args = namesArgs(["Old/r", "o/gone"]);
  const query = args[args.indexOf("-f") + 1] ?? "";
  assert.match(query, /r1: repository\(owner: \$o1, name: \$n1\) \{ nameWithOwner \}/);
  assert.ok(args.includes("o0=Old") && args.includes("n0=r") && args.includes("o1=o") && args.includes("n1=gone"));
  const names = parseNames(JSON.stringify({ data: { r0: { nameWithOwner: "new/r" }, r1: null }, errors: [{ message: "Could not resolve to a Repository" }] }), ["Old/r", "o/gone"]);
  assert.deepEqual([...names], [["Old/r", "new/r"]]);
});

test("list: a clone whose origin says its owner's old name lists its pull requests by the name GitHub has now, with where each is here", async () => {
  const s = await setup();
  await git(s.primary, "remote", "set-url", "origin", "https://github.com/old/r.git");
  // A review worktree by the name from before the repository's name was in it.
  await git(s.primary, "worktree", "add", "--detach", path.join(s.root, "r", "review-12"), "HEAD");
  const file = path.join(s.root, "watched.json");
  await fs.writeFile(file, JSON.stringify({ paths: [s.primary] }));

  const pr = (number: number, state = "OPEN") => ({ number, title: `t${number}`, url: `https://github.com/new/r/pull/${number}`, state, headRefName: `feat/${number}`, repository: { nameWithOwner: "new/r" } });
  const asked: string[][] = [];
  let found = true;
  const github: GitHubRead = async (args) => {
    asked.push(args);
    const query = args[args.indexOf("-f") + 1] ?? "";
    if (!query.includes("search(")) return { stdout: JSON.stringify({ data: { r0: found ? { nameWithOwner: "new/r" } : null } }) };
    // GitHub's search finds nothing by the old name.
    const watched = args.find((a) => a.startsWith("w0=")) ?? "";
    return {
      stdout: JSON.stringify({
        data: {
          req: { issueCount: 1, nodes: [pr(5)] },
          w0: { issueCount: watched.includes("repo:new/r ") ? 2 : 0, nodes: watched.includes("repo:new/r ") ? [pr(5), pr(6)] : [] },
          l0: args.includes("o0=new") ? { p12: pr(12, "MERGED") } : null,
        },
      }),
    };
  };
  let at = 0;
  const reviewer = new Reviewer({ exec, folders: () => [s.primary], file, log: () => {}, now: () => at });
  const listing = await reviewer.list(github, "", false);
  assert.deepEqual(listing.errors, []);
  assert.deepEqual(listing.requested.map((p) => [p.repo, p.number, p.place?.primary]), [["new/r", 5, s.primary]]);
  assert.deepEqual(
    listing.repos.map((r) => [r.repo, r.watched, r.prs.map((p) => [p.number, p.place?.worktree?.review ?? false])]),
    [["new/r", true, [[5, false], [6, false], [12, true]]]],
  );
  assert.equal(pageItems([{ machine: "m", listing }]).requested.length, 1);

  // The name is read once, then again only when it is an hour old.
  const names = () => asked.filter((a) => !(a[a.indexOf("-f") + 1] ?? "").includes("search(")).length;
  assert.equal(names(), 1);
  assert.equal((await reviewer.cloneOf(github, "NEW/r"))?.path, s.primary);
  assert.equal(names(), 1);
  // One GitHub does not find keeps its origin's name.
  at = 60 * 60_000;
  found = false;
  assert.equal(await reviewer.cloneOf(github, "new/r"), undefined);
  assert.equal((await reviewer.cloneOf(github, "old/r"))?.path, s.primary);
  assert.equal(names(), 2);
});

test("template: the placeholders become the pull request's, once; a setting that is not a list of templates gives none", () => {
  const pr = { number: 3, title: "Fix {url}", branch: "feat/3-x", url: "https://github.com/o/r/pull/3" };
  assert.equal(fillTemplate("#{number} {title} ({branch}) {url} {other}", pr), "#3 Fix {url} (feat/3-x) https://github.com/o/r/pull/3 {other}");
  // A value never starts what is sent (Claude Code would take "/…" for a command, "!…" for a shell command); the
  // template's own start, and values elsewhere, are kept.
  const odd = { ...pr, title: " /clear 直す", branch: "!rm-x" };
  assert.equal(fillTemplate("{title} をレビュー", odd), "clear 直す をレビュー");
  assert.equal(fillTemplate("  {branch}\n{title}", odd), "  rm-x\n /clear 直す");
  assert.equal(fillTemplate("{title}{branch}", { ...odd, title: "!!" }), "rm-x");
  // The template's own "/" would start it once the title before it comes to nothing.
  assert.equal(fillTemplate("{title}/{branch}", { ...odd, title: "!!", branch: "clear" }), "clear");
  assert.equal(fillTemplate("/review {title}", odd), "/review  /clear 直す");
  assert.deepEqual(parseTemplates('[{"name":" A ","body":"x"},{"name":"","body":"y"},{"name":"B"},"z"]'), [{ name: "A", body: "x" }]);
  assert.deepEqual(parseTemplates("not json"), []);
  assert.deepEqual(parseTemplates('{"name":"A","body":"x"}'), []);
});

test("page: a pull request listed by several working servers shows once, with where it is on each; one without a clone anywhere is left out", () => {
  const row = (number: number, over: Partial<PrRow> = {}): PrRow => ({
    repo: "o/r",
    number,
    title: `t${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    state: "open",
    labels: [],
    comments: 0,
    branch: `feat/${number}`,
    ...over,
  });
  const a: Listing = {
    watched: ["/a/r"],
    requested: [row(1, { place: { primary: "/a/r" } }), row(4, { repo: "x/y" })],
    repos: [{ repo: "o/r", watched: true, prs: [row(1, { place: { primary: "/a/r" } }), row(2)] }],
    errors: [],
  };
  const b: Listing = {
    watched: [],
    requested: [row(1, { place: { primary: "/b/r", worktree: { path: "/b/review-1", branch: "feat/1", review: true } } })],
    repos: [{ repo: "O/R", watched: false, prs: [row(3, { state: "merged", place: { primary: "/b/r", worktree: { path: "/b/review-3", review: true } } })] }],
    requestedMore: 4,
    errors: [],
  };
  const page = pageItems([
    { machine: "A", listing: a },
    { machine: "B", listing: b },
  ]);
  assert.deepEqual(
    page.requested.map((i) => [i.pr.number, i.spots.map((s) => [s.machine, s.worktree?.path])]),
    [[1, [["A", undefined], ["B", "/b/review-1"]]]],
  );
  assert.deepEqual(
    page.groups.map((g) => [g.repo, g.watched, g.items.map((i) => [i.pr.number, i.spots.length])]),
    [["o/r", true, [[1, 2], [3, 1]]]],
  );
  assert.equal("place" in (page.requested[0]?.pr ?? {}), false);
  assert.equal(page.requestedMore, 4);
});

test("まとめてレビューさせる: the pull requests with no worktree on any working server and a clone on the one chosen", () => {
  const row = (number: number, place?: PrRow["place"]): PrRow => ({
    repo: "o/r",
    number,
    title: `t${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    state: "open",
    labels: [],
    comments: 0,
    branch: `feat/${number}`,
    ...(place ? { place } : {}),
  });
  const a: Listing = {
    watched: [],
    // 1: on A only. 2: on both, a worktree on B. 3: on both, none anywhere.
    requested: [row(1, { primary: "/a/r" }), row(2, { primary: "/a/r" }), row(3, { primary: "/a/r" })],
    repos: [],
    errors: [],
  };
  const b: Listing = {
    watched: [],
    requested: [row(2, { primary: "/b/r", worktree: { path: "/b/review-2", review: true } }), row(3, { primary: "/b/r" })],
    repos: [],
    errors: [],
  };
  const { requested } = pageItems([
    { machine: "A", listing: a },
    { machine: "B", listing: b },
  ]);
  assert.deepEqual(
    batchTargets(requested, "A").map((x) => [x.item.pr.number, x.spot.primary]),
    [
      [1, "/a/r"],
      [3, "/a/r"],
    ],
  );
  assert.deepEqual(
    batchTargets(requested, "B").map((x) => [x.item.pr.number, x.spot.primary]),
    [[3, "/b/r"]],
  );
  assert.deepEqual(batchTargets(requested, "C"), []);

  // One from a fork is left out, even with no worktree anywhere: it is started from its own row.
  const { requested: withFork } = pageItems([
    { machine: "A", listing: { ...a, requested: [row(1, { primary: "/a/r" }), { ...row(4, { primary: "/a/r" }), fork: true }] } },
  ]);
  assert.deepEqual(
    batchTargets(withFork, "A").map((x) => x.item.pr.number),
    [1],
  );

  // A search without is:open lists merged and closed ones too: only the open one is done.
  const { requested: withEnded } = pageItems([
    {
      machine: "A",
      listing: {
        ...a,
        requested: [row(1, { primary: "/a/r" }), { ...row(5, { primary: "/a/r" }), state: "merged" }, { ...row(6, { primary: "/a/r" }), state: "closed" }],
      },
    },
  ]);
  assert.deepEqual(
    batchTargets(withEnded, "A").map((x) => x.item.pr.number),
    [1],
  );

  // My own: one with no worktree is done like any other; the one I made in its worktree, or from my fork, is not.
  const { requested: withOwn } = pageItems([
    {
      machine: "A",
      listing: {
        ...a,
        requested: [
          { ...row(7, { primary: "/a/r" }), own: true },
          { ...row(8, { primary: "/a/r", worktree: { path: "/a/my-work", branch: "feat/8", review: false } }), own: true },
          { ...row(9, { primary: "/a/r" }), own: true, fork: true },
        ],
      },
    },
  ]);
  assert.deepEqual(
    batchTargets(withOwn, "A").map((x) => x.item.pr.number),
    [7],
  );
});
