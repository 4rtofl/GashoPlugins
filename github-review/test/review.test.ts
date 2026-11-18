import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";
import { pageItems } from "../src/items.ts";
import { listArgs, namesArgs, parseList, parseNames, requestedQuery, watchedQueries } from "../src/daemon/gh.ts";
import { createWorktree, prWorktree, readClone, removeWorktree, repoName, ReviewError, reviewName, reviewNumbers, type Clone, type Exec } from "../src/daemon/git.ts";
import { Reviewer, type GitHubRead } from "../src/daemon/reviewer.ts";
import { inOrder, openWords, repoWords } from "../src/search.ts";
import { fillTemplate, readTemplates } from "../src/template.ts";
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

/** A repository "o/r" with a bare origin, branches feat/5-a and feat/6-b, a pull request #7 from a fork (refs/pull/7/head) and a clone at <root>/r/main. */
async function setup(): Promise<{ root: string; primary: string; clone: () => Promise<Clone>; sha: (ref: string) => Promise<string> }> {
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
  await git(seed, "checkout", "-b", "fork-work", "main");
  await commit("from a fork");
  await git(seed, "push", "origin", "HEAD:refs/pull/7/head");
  const primary = path.join(root, "r", "main");
  await fs.mkdir(path.dirname(primary));
  await run("git", ["clone", origin, primary]);
  return {
    root,
    primary,
    clone: () => readClone(exec, { path: primary, github: "o/r" }),
    sha: (ref) => git(origin, "rev-parse", ref),
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

test("worktree: a pull request from a fork is checked out at its head, detached; a folder of that name that is no worktree is left alone", async () => {
  const s = await setup();
  const made = await createWorktree(exec, await s.clone(), { number: 7, branch: "main", fork: true });
  const dest = path.join(s.root, "r", "review-r-7");
  assert.deepEqual(made, { path: dest, created: true });
  assert.equal(await git(dest, "rev-parse", "HEAD"), await s.sha("refs/pull/7/head"));
  assert.equal(await git(dest, "branch", "--show-current"), "");
  // The fork's branch is "main", which says nothing of the primary checkout on main.
  assert.equal(prWorktree(await s.clone(), { number: 8, branch: "main", fork: true }), undefined);

  await fs.mkdir(path.join(s.root, "r", "review-r-9"));
  await assert.rejects(createWorktree(exec, await s.clone(), { number: 9, branch: "feat/6-b", fork: false }), (e: unknown) => e instanceof ReviewError && /がもうあります/.test(e.message));
});

test("worktree: a local branch of the pull request's name is moved up to origin's; one with commits origin lacks stays, and the worktree is detached", async () => {
  const s = await setup();
  await git(s.primary, "branch", "feat/6-b", "origin/main");
  const made = await createWorktree(exec, await s.clone(), { number: 6, branch: "feat/6-b", fork: false });
  assert.equal(await git(made.path, "rev-parse", "HEAD"), await s.sha("feat/6-b"));
  assert.equal(await git(made.path, "rev-parse", "--abbrev-ref", "@{upstream}"), "origin/feat/6-b");

  // The author force-pushed after the reviewer's local branch was made: pushing that branch would undo it.
  await git(s.primary, "fetch", "origin", "feat/5-a:feat/5-a");
  await git(s.primary, "checkout", "feat/5-a");
  await fs.writeFile(path.join(s.primary, "g.txt"), "mine\n");
  await git(s.primary, "add", ".");
  await git(s.primary, "commit", "-m", "mine");
  await git(s.primary, "checkout", "main");
  const mine = await git(s.primary, "rev-parse", "feat/5-a");
  const kept = await createWorktree(exec, await s.clone(), { number: 5, branch: "feat/5-a", fork: false });
  assert.deepEqual([kept.path, kept.created, kept.branch], [path.join(s.root, "r", "review-r-5"), true, undefined]);
  assert.match(kept.note ?? "", /ローカルのブランチ feat\/5-a に origin に無い commit があるので、そのままにして/);
  assert.equal(await git(kept.path, "rev-parse", "HEAD"), await s.sha("feat/5-a"));
  assert.equal(await git(s.primary, "rev-parse", "feat/5-a"), mine);
});

test("worktree: a clone of one branch tracks the pull request's branch; one whose branch is gone from origin is made at refs/pull/<number>/head", async () => {
  const s = await setup();
  const single = path.join(s.root, "s", "main");
  await fs.mkdir(path.dirname(single));
  await run("git", ["clone", "--single-branch", "--depth", "1", `file://${path.join(s.root, "origin.git")}`, single]);
  const clone = await readClone(exec, { path: single, github: "o/r" });
  const made = await createWorktree(exec, clone, { number: 5, branch: "feat/5-a", fork: false });
  assert.deepEqual(made, { path: path.join(s.root, "s", "review-r-5"), created: true, branch: "feat/5-a" });
  assert.equal(await git(made.path, "rev-parse", "HEAD"), await s.sha("feat/5-a"));
  assert.deepEqual([await git(single, "config", "branch.feat/5-a.remote"), await git(single, "config", "branch.feat/5-a.merge")], ["origin", "refs/heads/feat/5-a"]);

  // Merged, and its branch deleted: GitHub keeps the pull request's head.
  const origin = path.join(s.root, "origin.git");
  const head = await s.sha("feat/6-b");
  await git(origin, "update-ref", "refs/pull/6/head", head);
  await git(origin, "branch", "-D", "feat/6-b");
  const gone = await createWorktree(exec, await s.clone(), { number: 6, branch: "feat/6-b", fork: false });
  assert.deepEqual([gone.created, gone.branch], [true, undefined]);
  assert.match(gone.note ?? "", /Pull request の head を detached HEAD で取ってきました/);
  assert.equal(await git(gone.path, "rev-parse", "HEAD"), head);
});

test("remove: not while something would be lost; then the worktree and its local branch go, and a merged branch gone from origin counts as pushed", async () => {
  const s = await setup();
  const pr = { number: 5, branch: "feat/5-a", fork: false };
  const { path: dest } = await createWorktree(exec, await s.clone(), pr);

  await fs.writeFile(path.join(dest, "f.txt"), "changed\n");
  await assert.rejects(removeWorktree(exec, await s.clone(), pr), (e: unknown) => e instanceof ReviewError && /未コミットの変更が 1 件/.test(e.message));
  await git(dest, "checkout", "--", "f.txt");
  await fs.writeFile(path.join(dest, "new.txt"), "draft\n");
  await git(dest, "add", ".");
  await git(dest, "commit", "-m", "fix");
  await assert.rejects(removeWorktree(exec, await s.clone(), pr), (e: unknown) => e instanceof ReviewError && /push していない commit が 1 個/.test(e.message));
  await git(dest, "push", "origin", "HEAD:feat/5-a");

  // Merged and deleted on GitHub, and pruned here: only the pull request's head says the commits were pushed.
  const head = await s.sha("feat/5-a");
  await git(s.root, "--git-dir", path.join(s.root, "origin.git"), "branch", "-D", "feat/5-a");
  await git(s.primary, "fetch", "--prune", "origin");
  await assert.rejects(removeWorktree(exec, await s.clone(), pr), (e: unknown) => e instanceof ReviewError && /push していない commit が 2 個/.test(e.message));

  // Files git does not track go only as the person saw them, whatever status.showUntrackedFiles says.
  await git(dest, "config", "status.showUntrackedFiles", "no");
  await fs.writeFile(path.join(dest, ".gitignore"), ".env.local\n");
  await fs.writeFile(path.join(dest, ".env.local"), "TOKEN=x\n");
  const listed = await removeWorktree(exec, await s.clone(), { ...pr, head }, { check: true });
  assert.deepEqual([listed.removed, listed.files, listed.fileCount], [false, [".env.local", ".gitignore"], 2]);
  await fs.writeFile(path.join(dest, "notes.txt"), "mine\n");
  const changed = await removeWorktree(exec, await s.clone(), { ...pr, head }, { ...(listed.token ? { agreed: listed.token } : {}) });
  assert.deepEqual([changed.removed, changed.files], [false, [".env.local", ".gitignore", "notes.txt"]]);
  await fs.lstat(path.join(dest, "notes.txt"));
  const gone = await removeWorktree(exec, await s.clone(), { ...pr, head }, { ...(changed.token ? { agreed: changed.token } : {}) });
  assert.deepEqual([gone.path, gone.branch, gone.removed, gone.fileCount], [dest, "feat/5-a", true, 3]);
  await assert.rejects(fs.lstat(dest));
  assert.equal(await git(s.primary, "branch", "--list", "feat/5-a"), "");

  // A fork's pull request that got a commit after its worktree was made: the new head is fetched, and the commits before it count as pushed.
  const fork = { number: 7, branch: "main", fork: true };
  const { path: forkDest } = await createWorktree(exec, await s.clone(), fork);
  const origin = path.join(s.root, "origin.git");
  const old = await s.sha("refs/pull/7/head");
  const next = await git(origin, "commit-tree", await s.sha(`${old}^{tree}`), "-p", old, "-m", "more from the fork");
  await git(origin, "update-ref", "refs/pull/7/head", next);
  await git(s.primary, "remote", "set-url", "origin", path.join(s.root, "nowhere.git"));
  await assert.rejects(removeWorktree(exec, await s.clone(), { ...fork, head: next }), (e: unknown) => e instanceof ReviewError && /head を取ってこられなかった/.test(e.message));
  await git(s.primary, "remote", "set-url", "origin", origin);
  assert.deepEqual(await removeWorktree(exec, await s.clone(), { ...fork, head: next }), { path: forkDest, removed: true, files: [], fileCount: 0 });

  // Only review worktrees are removed: a worktree of the branch made by hand only opens.
  await git(s.primary, "worktree", "add", path.join(s.root, "r", "issue-6"), "-b", "feat/6-b", "origin/feat/6-b");
  assert.deepEqual(prWorktree(await s.clone(), { number: 6, branch: "feat/6-b" }), { path: path.join(s.root, "r", "issue-6"), branch: "feat/6-b", review: false });
  await assert.rejects(removeWorktree(exec, await s.clone(), { number: 6, branch: "feat/6-b", fork: false }), ReviewError);
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
  await createWorktree(exec, await s.clone(), { number: 7, branch: "main", fork: true });
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
  assert.deepEqual(await removeWorktree(exec, await s.clone(), { ...old, head: await s.sha("feat/5-a") }), { path: at("review-5"), branch: "feat/5-a", files: [], fileCount: 0, removed: true });
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
  assert.deepEqual(watchedQueries([], "is:open"), []);
});

test("search words: the upper part reads only open pull requests; repo:, org: and user: narrow the watched repositories instead of going to GitHub", () => {
  assert.equal(requestedQuery("sort:updated-desc"), "is:pr is:open review-requested:@me archived:false sort:updated-desc");
  assert.equal(requestedQuery("is:open label:bug"), "is:pr is:open review-requested:@me archived:false label:bug sort:created-desc");
  assert.equal(requestedQuery("-is:closed"), "is:pr is:open review-requested:@me archived:false sort:created-desc");
  for (const words of ["is:merged", "is:closed author:x", "-is:open", "state:closed", "-is:unmerged"]) assert.equal(requestedQuery(words), undefined, words);
  assert.equal(openWords('label:"good first issue" is:open'), 'label:"good first issue"');

  const { words, names } = repoWords("org:Other repo:o/r -repo:o/s is:open");
  assert.equal(words, "-repo:o/s is:open");
  assert.deepEqual(["o/r", "O/s", "other/x", "o/t"].filter((r) => names?.(r)), ["o/r", "other/x"]);
  assert.equal(repoWords("is:open").names, undefined);

  // Searches put together in the order of the words; one the page cannot follow keeps theirs.
  const at = (n: number, createdAt: string, updatedAt = createdAt) => ({ n, createdAt, updatedAt });
  const prs = [at(1, "2026-11-01T00:00:00Z", "2026-11-09T00:00:00Z"), at(2, "2026-11-03T00:00:00Z"), at(3, "2026-11-02T00:00:00Z")];
  assert.deepEqual(inOrder(prs, "is:open").map((p) => p.n), [2, 3, 1]);
  assert.deepEqual(inOrder(prs, "sort:updated-desc").map((p) => p.n), [1, 2, 3]);
  assert.deepEqual(inOrder(prs, "sort:created-asc").map((p) => p.n), [1, 3, 2]);
  assert.deepEqual(inOrder(prs, "sort:reactions-desc").map((p) => p.n), [1, 2, 3]);
});

test("gh: each part of the answer comes back to its part of the query, with what GitHub could not answer", () => {
  const lookups = [{ repo: "o/r", numbers: [12, 99] }];
  const args = listArgs({ requested: requestedQuery(""), watched: ["is:pr repo:o/r", "is:pr repo:o/s"], counts: ["is:pr repo:o/r"], kept: ["is:pr is:open repo:x/z"], lookups });
  const query = args[args.indexOf("-f") + 1] ?? "";
  assert.match(query, /req: search\(query: \$req/);
  assert.match(query, /w1: search\(query: \$w1/);
  assert.match(query, /c0: search\(query: \$c0, type: ISSUE, first: 0\) \{ issueCount  \}/);
  assert.match(query, /k0: search\(query: \$k0, type: ISSUE, first: 50\) \{ issueCount nodes \{ \.\.\. on PullRequest \{ url \} \} \}/);
  assert.match(query, /l0: repository\(owner: \$o0, name: \$n0\) \{ p12: pullRequest\(number: 12\)/);
  assert.ok(args.includes("w1=is:pr repo:o/s") && args.includes("o0=o") && args.includes("n0=r"));
  // The upper part is not read when the words find no open pull request.
  assert.doesNotMatch(listArgs({ watched: [], counts: [], kept: [], lookups: [] })[3] ?? "", /req:/);

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
        c0: { issueCount: 7 },
        k0: { issueCount: 2, nodes: [{ url: "https://github.com/x/z/pull/4" }] },
        l0: { p12: pr("o/r", 12, { state: "MERGED" }), p99: null },
      },
      errors: [{ message: "Could not resolve to a PullRequest with the number of 99." }],
    }),
    { watched: ["is:pr repo:o/r", "is:pr repo:o/s"], counts: ["is:pr repo:o/r"], kept: ["is:pr is:open repo:x/z"], lookups },
  );
  assert.deepEqual(
    answer.requested.prs.map((p) => [p.repo, p.number, p.fork, p.review, p.checks, p.labels]),
    [["x/y", 1, true, "changes_requested", "failure", [{ name: "bug", color: "d73a4a" }]]],
  );
  assert.equal(answer.requested.total, 3);
  assert.deepEqual(
    answer.watched.map((w) => w.prs.map((p) => [p.number, p.draft])),
    [[[2, true]], []],
  );
  assert.deepEqual(answer.counts, [7]);
  // GitHub found 2 but gave 1: whether another is kept cannot be said from it.
  assert.deepEqual(answer.kept, [{ urls: ["https://github.com/x/z/pull/4"], all: false }]);
  assert.deepEqual(
    answer.lookups.map((l) => l.map((p) => [p.number, p.state])),
    [[[12, "merged"]]],
  );
  assert.deepEqual(answer.errors, ["Could not resolve to a PullRequest with the number of 99."]);
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
  // #12 is merged: the search with is:open does not find it, and it is kept for its review worktree.
  const parts = (l: Listing) => l.repos.map((r) => [r.repo, r.watched, r.total, r.prs.map((p) => p.number), r.kept.map((p) => [p.number, p.place?.worktree?.review])]);
  assert.deepEqual(parts(listing), [["new/r", true, 2, [5, 6], [[12, true]]]]);
  assert.equal(pageItems([{ machine: "m", listing }], "").requested.length, 1);
  // Words that name other repositories leave the watched one unsearched, rather than search them all with it.
  const before = asked.length;
  const other = await reviewer.list(github, "org:someone is:open", false);
  assert.equal(asked.slice(before).flat().filter((a) => a.startsWith("w0=")).length, 0);
  assert.deepEqual(parts(other), [["new/r", true, 0, [], [[12, true]]]]);

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

// A list that waited for the folders would wait on `hold` for ever: the timeout says so.
test("list: the folders listed again do not hold up the answer; a broken watched.json starts from none and says so", { timeout: 180_000 }, async () => {
  const s = await setup();
  await git(s.primary, "remote", "set-url", "origin", "https://github.com/o/r.git");
  const file = path.join(s.root, "watched.json");
  await fs.writeFile(file, "{ broken");
  let hold: Promise<void> | undefined;
  let listings = 0;
  // Listing the folders waits on `hold`, as git does on a busy working server.
  const slow: Exec = async (command, args, o) => {
    if (args.includes("--git-common-dir")) {
      listings++;
      await hold;
    }
    return exec(command, args, o);
  };
  const github: GitHubRead = async () => ({ stdout: JSON.stringify({ data: {} }) });
  let at = 0;
  const reviewer = new Reviewer({ exec: slow, folders: () => [s.primary], file, log: () => {}, now: () => at });
  const first = await reviewer.list(github, "", false);
  assert.match(first.errors.join("\n"), /watched\.json）が壊れていた/);
  assert.deepEqual([first.watched, await reviewer.watching()], [[], []]);
  assert.deepEqual(await reviewer.watch([s.primary]), [s.primary]);
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), { paths: [s.primary] });
  assert.deepEqual((await reviewer.list(github, "", false)).errors, []);

  at = 5 * 60_000;
  let release = () => {};
  hold = new Promise((r) => (release = r));
  const was = listings;
  const later = await reviewer.list(github, "", false);
  assert.equal(listings, was + 1);
  assert.deepEqual(later.repos.map((r) => r.repo), ["o/r"]);
  release();
  await reviewer.repoOptions();
});

test("list and create take the same clone of a repository cloned twice: the one with the pull request's worktree, else the watched one, else the first by path", async () => {
  const s = await setup();
  const second = path.join(s.root, "q", "main");
  await fs.mkdir(path.dirname(second));
  await run("git", ["clone", path.join(s.root, "origin.git"), second]);
  for (const p of [s.primary, second]) await git(p, "remote", "set-url", "origin", "https://github.com/o/r.git");
  await git(second, "worktree", "add", "--detach", path.join(s.root, "q", "review-6"), "HEAD");
  const file = path.join(s.root, "watched.json");
  const pr = (number: number, state = "OPEN") => ({ number, title: `t${number}`, url: `https://github.com/o/r/pull/${number}`, state, headRefName: `feat/${number}`, repository: { nameWithOwner: "o/r" } });
  const github: GitHubRead = async (args) => {
    const query = args[args.indexOf("-f") + 1] ?? "";
    if (!query.includes("search(")) return { stdout: JSON.stringify({ data: { r0: { nameWithOwner: "o/r" } } }) };
    return { stdout: JSON.stringify({ data: { req: { issueCount: 1, nodes: [pr(5)] }, l0: { p6: pr(6, "MERGED") } } }) };
  };
  // The folders in an order other than by path.
  const reviewer = new Reviewer({ exec, folders: () => [s.primary, second], file, log: () => {} });
  const places = async () => {
    const l = await reviewer.list(github, "", false);
    return [l.requested[0]?.place?.primary, l.repos[0]?.kept[0]?.place?.primary];
  };
  const made = async (number: number) => (await reviewer.cloneOf(github, "o/r", { pr: { number, branch: `feat/${number}` }, wait: true }))?.path;
  assert.deepEqual(await places(), [second, second]);
  assert.deepEqual([await made(5), await made(6)], [second, second]);
  await reviewer.watch([s.primary]);
  assert.deepEqual(await places(), [s.primary, second]);
  assert.deepEqual([await made(5), await made(6)], [s.primary, second]);
  // The worktrees are not read with git while their files stay as they were, and are once they change.
  await git(second, "worktree", "add", path.join(s.root, "q", "review-5"), "-b", "feat/5", "HEAD");
  assert.deepEqual(await places(), [second, second]);
  await git(path.join(s.root, "q", "review-5"), "checkout", "-b", "feat/other");
  assert.equal((await reviewer.cloneOf(github, "o/r", { pr: { number: 5, branch: "feat/5" } }))?.worktrees.find((w) => w.path.endsWith("review-5"))?.branch, "feat/other");
});

test("template: the placeholders become the pull request's, once ({branch} of a fork's is OWNER:BRANCH); a setting with what is not a template says so", () => {
  const pr = { number: 3, title: "Fix {url}", branch: "feat/3-x", url: "https://github.com/o/r/pull/3" };
  assert.equal(fillTemplate("#{number} {title} ({branch}) {url} {other}", pr), "#3 Fix {url} (feat/3-x) https://github.com/o/r/pull/3 {other}");
  assert.equal(fillTemplate("{branch}", { ...pr, branch: "main", fork: true, headOwner: "someone" }), "someone:main");
  const mixed = readTemplates('[{"name":" A ","body":"x"},{"name":"","body":"y"},{"name":"B"},"z"]');
  assert.deepEqual(mixed.templates, [{ name: "A", body: "x" }]);
  assert.match(mixed.problem ?? "", /3 個は、使えないので出していません/);
  for (const raw of ["not json", '{"name":"A","body":"x"}']) {
    const r = readTemplates(raw);
    assert.deepEqual(r.templates, []);
    assert.match(r.problem ?? "", /テンプレートを使えません/);
  }
  assert.deepEqual(readTemplates(""), { templates: [] });
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
  // Both working servers watch o/r: what GitHub found there counts once.
  const a: Listing = {
    watched: ["/a/r"],
    requested: [row(1, { place: { primary: "/a/r" } }), row(4, { repo: "x/y" })],
    requestedTotal: 7,
    repos: [{ repo: "o/r", watched: true, prs: [row(1, { place: { primary: "/a/r" } }), row(2, { place: { primary: "/a/r" } })], total: 60, kept: [] }],
    errors: [],
  };
  const b: Listing = {
    watched: ["/b/r"],
    requested: [row(1, { place: { primary: "/b/r", worktree: { path: "/b/review-1", branch: "feat/1", review: true } } })],
    requestedTotal: 7,
    repos: [{ repo: "O/R", watched: true, prs: [row(2, { place: { primary: "/b/r" } })], total: 60, kept: [row(3, { state: "merged", place: { primary: "/b/r", worktree: { path: "/b/review-3", review: true } } })] }],
    errors: [],
  };
  const page = pageItems(
    [
      { machine: "A", listing: a },
      { machine: "B", listing: b },
    ],
    "is:open",
  );
  assert.deepEqual(
    page.requested.map((i) => [i.pr.number, i.spots.map((s) => [s.machine, s.worktree?.path])]),
    [[1, [["A", undefined], ["B", "/b/review-1"]]]],
  );
  assert.deepEqual(
    page.groups.map((g) => [g.repo, g.watched, g.total, g.items.map((i) => [i.pr.number, i.spots.length])]),
    [["o/r", true, 60, [[1, 2], [2, 2], [3, 1]]]],
  );
  assert.equal("place" in (page.requested[0]?.pr ?? {}), false);
  // #4 was read but has no clone anywhere; 7 found, 2 read.
  assert.deepEqual([page.requestedNoClone, page.requestedMore, page.watchedMore], [1, 5, 58]);

  // Watched repositories in several searches: the newest SEARCH_LIMIT of them all.
  const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T00:00:00Z`;
  const many = (repo: string, from: number): PrRow[] =>
    Array.from({ length: 30 }, (_, i) => row(from + i, { repo, url: `https://github.com/${repo}/pull/${from + i}`, createdAt: day(1 + ((from + i) % 31)), place: { primary: `/c/${repo}` } }));
  const c: Listing = {
    watched: ["/c/p/a", "/c/p/b"],
    requested: [],
    requestedTotal: 0,
    repos: [
      { repo: "p/a", watched: true, prs: many("p/a", 0), total: 30, kept: [] },
      { repo: "p/b", watched: true, prs: many("p/b", 30), total: 30, kept: [] },
    ],
    errors: [],
  };
  const capped = pageItems([{ machine: "C", listing: c }], "");
  const shown = capped.groups.flatMap((g) => g.items);
  assert.equal(shown.length, 50);
  assert.equal(capped.watchedMore, 10);
  const oldestShown = Math.min(...shown.map((i) => Date.parse(i.pr.createdAt ?? "")));
  const all = c.repos.flatMap((r) => r.prs);
  assert.ok(all.filter((p) => !shown.some((i) => i.pr.url === p.url)).every((p) => Date.parse(p.createdAt ?? "") <= oldestShown));
});
