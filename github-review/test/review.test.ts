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

  // Merged and deleted on GitHub, and pruned here: only the pull request's head says the commits were pushed.
  const head = await s.sha("feat/5-a");
  await git(s.root, "--git-dir", path.join(s.root, "origin.git"), "branch", "-D", "feat/5-a");
  await git(s.primary, "fetch", "--prune", "origin");
  await assert.rejects(removeWorktree(exec, await s.clone(), pr), (e: unknown) => e instanceof ReviewError && /push していない commit が 2 個/.test(e.message));
  assert.deepEqual(await removeWorktree(exec, await s.clone(), { ...pr, head }), { path: dest, branch: "feat/5-a" });
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
  const args = listArgs({ requested: requestedQuery(""), watched: ["is:pr repo:o/r", "is:pr repo:o/s"], lookups });
  const query = args[args.indexOf("-f") + 1] ?? "";
  assert.match(query, /req: search\(query: \$req/);
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
