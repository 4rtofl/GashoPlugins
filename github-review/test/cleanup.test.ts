import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";
import { changesProblem, cleanable, cleanupDone, CLOCK_SLACK_MS } from "../src/cleanup.ts";
import { CLAIM_MS, Cleanups } from "../src/daemon/cleanups.ts";
import { listArgs, parsePr, requestedQuery } from "../src/daemon/gh.ts";
import type { Exec } from "../src/daemon/git.ts";
import { Reviewer, type GitHubRead } from "../src/daemon/reviewer.ts";
import { pageItems } from "../src/items.ts";

const run = promisify(execFile);

const roots: string[] = [];
after(() => Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true }))));

async function tmp(): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "github-review-cleanup-")));
  roots.push(root);
  return root;
}

const exec: Exec = async (command, args, o = {}) => {
  const { stdout, stderr } = await run(command, args, { cwd: o.cwd, timeout: o.timeoutMs ?? 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...o.env } });
  return { stdout, stderr };
};

const git = async (cwd: string, ...args: string[]) =>
  (await run("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "init.defaultBranch=main", ...args])).stdout.trim();

test("done: a merge once the pull request is merged; a send-back once I requested changes after it was asked", () => {
  const asked = Date.parse("2026-11-17T10:00:00Z");
  assert.equal(cleanupDone("merge", { state: "open" }, asked), false);
  assert.equal(cleanupDone("merge", { state: "closed" }, asked), false);
  assert.equal(cleanupDone("merge", { state: "merged" }, asked), true);
  assert.equal(cleanupDone("sendBack", { state: "open" }, asked), false);
  // An earlier round's request for changes is not this one; GitHub's clock may run a little behind.
  assert.equal(cleanupDone("sendBack", { state: "open", changesRequestedAt: "2026-11-17T09:30:00Z" }, asked), false);
  assert.equal(cleanupDone("sendBack", { state: "open", changesRequestedAt: new Date(asked - CLOCK_SLACK_MS + 1000).toISOString() }, asked), true);
  assert.equal(cleanupDone("sendBack", { state: "open", changesRequestedAt: "2026-11-17T10:05:00Z" }, asked), true);
  assert.equal(cleanupDone("sendBack", { state: "open", changesRequestedAt: "not a time" }, asked), false);

  assert.equal(changesProblem({ uncommitted: 2, unpushed: 0 }), "未コミットの変更（2 件）があるので、自動では片付けませんでした。");
  assert.equal(changesProblem({ uncommitted: 1, unpushed: 3 }), "未コミットの変更（1 件）と push していない commit（3 個）があるので、自動では片付けませんでした。");
});

test("cleanable: a merge takes a worktree of any name, a send-back only a review worktree, neither the primary checkout", () => {
  const named = { path: "/r/my-work", review: false };
  const review = { path: "/r/review-r-5", review: true };
  assert.equal(cleanable("merge", named, "/r/main"), true);
  assert.equal(cleanable("merge", review, "/r/main"), true);
  assert.equal(cleanable("sendBack", named, "/r/main"), false);
  assert.equal(cleanable("sendBack", review, "/r/main"), true);
  assert.equal(cleanable("merge", { path: "/r/main", review: false }, "/r/main"), false);
});

test("list: a merge asked from a worktree of any name is followed after the pull request leaves the lists", async () => {
  const root = await tmp();
  const primary = path.join(root, "r", "main");
  await fs.mkdir(primary, { recursive: true });
  await run("git", ["init", "-b", "main", primary]);
  await git(primary, "commit", "--allow-empty", "-m", "base");
  await git(primary, "remote", "add", "origin", "https://github.com/o/r.git");
  await git(primary, "worktree", "add", "-b", "feat/5", path.join(root, "r", "my-work"), "HEAD");
  await git(primary, "worktree", "add", "-b", "feat/6", path.join(root, "r", "other-work"), "HEAD");
  await git(primary, "branch", "feat/7");
  const file = path.join(root, "watched.json");
  await fs.writeFile(file, JSON.stringify({ paths: [primary] }));

  const cleanups = new Cleanups({ file: path.join(root, "cleanups.json"), log: () => {} });
  await cleanups.follow("o/r", 5, "merge");
  await cleanups.follow("o/r", 6, "sendBack");
  await cleanups.follow("o/r", 7, "merge");
  await cleanups.follow("o/r", 9, "merge");

  const pr = (number: number, state: string) => ({
    number,
    title: `t${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    state,
    headRefName: `feat/${number}`,
    repository: { nameWithOwner: "o/r" },
  });
  const github: GitHubRead = async (args) => {
    const query = args[args.indexOf("-f") + 1] ?? "";
    if (!query.includes("search(")) return { stdout: JSON.stringify({ data: { r0: { nameWithOwner: "o/r" } } }) };
    // #9 is not answered: GitHub may fail for one, and that says nothing of its worktree.
    return { stdout: JSON.stringify({ data: { req: { issueCount: 0, nodes: [] }, w0: { issueCount: 0, nodes: [] }, l0: { p5: pr(5, "MERGED"), p6: pr(6, "OPEN"), p7: pr(7, "MERGED") } } }) };
  };
  const reviewer = new Reviewer({ exec, folders: () => [primary], file, log: () => {}, cleanups });
  const listing = await reviewer.list(github, "", false);
  const rows = listing.repos.flatMap((r) => r.prs);
  assert.deepEqual(rows.map((p) => [p.number, p.place?.worktree?.path, p.place?.cleanup]), [[5, path.join(root, "r", "my-work"), { kind: "merge", done: true }]]);
  // #6 was a send-back from a worktree not made for the review, #7 has no worktree: forgotten. #9 waits for an answer.
  assert.deepEqual((await cleanups.all()).map((e) => e.number), [5, 9]);
});

test("gh: the query reads the reviews that request changes; only mine count, the latest", () => {
  const args = listArgs({ requested: requestedQuery(""), watched: [], lookups: [] });
  assert.match(args[args.indexOf("-f") + 1] ?? "", /changes: reviews\(last: 5, states: \[CHANGES_REQUESTED\]\) \{ nodes \{ viewerDidAuthor submittedAt \} \}/);
  const pr = (changes: unknown) =>
    parsePr({ number: 3, title: "t", url: "https://github.com/o/r/pull/3", state: "OPEN", headRefName: "feat/3", repository: { nameWithOwner: "o/r" }, changes });
  assert.equal(
    pr({
      nodes: [
        { viewerDidAuthor: true, submittedAt: "2026-11-17T09:00:00Z" },
        { viewerDidAuthor: true, submittedAt: "2026-11-17T11:00:00Z" },
        { viewerDidAuthor: false, submittedAt: "2026-11-17T12:00:00Z" },
        { viewerDidAuthor: true, submittedAt: null },
      ],
    })?.changesRequestedAt,
    "2026-11-17T11:00:00Z",
  );
  assert.equal(pr({ nodes: [{ viewerDidAuthor: false, submittedAt: "2026-11-17T12:00:00Z" }] })?.changesRequestedAt, undefined);
  assert.equal(pr(undefined)?.changesRequestedAt, undefined);
});

test("cleanups: kept in the file; one page claims at a time; a failure stays with its reason and is not claimed again", async () => {
  const root = await tmp();
  const file = path.join(root, "data", "cleanups.json");
  let now = 1000;
  const a = new Cleanups({ file, log: () => {}, now: () => now });
  await a.follow("O/r", 5, "merge");
  await a.follow("o/r", 6, "sendBack");
  assert.deepEqual(await a.get("o/R", 5), { repo: "O/r", number: 5, kind: "merge", at: 1000 });

  // Another process (gasho-daemon started again) reads them back.
  const b = new Cleanups({ file, log: () => {}, now: () => now });
  assert.deepEqual((await b.all()).map((e) => [e.number, e.kind]), [[5, "merge"], [6, "sendBack"]]);

  assert.equal(await b.claim("o/r", 5), true);
  assert.equal(await b.claim("o/r", 5), false);
  now += CLAIM_MS;
  assert.equal(await b.claim("o/r", 5), true);
  assert.equal(await b.claim("o/r", 7), false);

  await b.fail("o/r", 5, "未コミットの変更（1 件）があるので、自動では片付けませんでした。");
  assert.equal((await b.get("o/r", 5))?.problem, "未コミットの変更（1 件）があるので、自動では片付けませんでした。");
  now += CLAIM_MS;
  assert.equal(await b.claim("o/r", 5), false);
  // Asked again, it starts over.
  await b.follow("o/r", 5, "merge");
  assert.equal((await b.get("o/r", 5))?.problem, undefined);
  assert.equal(await b.claim("o/r", 5), true);

  await b.forget("o/r", 5);
  await b.prune((e) => e.number === 6);
  assert.deepEqual(await new Cleanups({ file, log: () => {} }).all(), []);
});

test("list: a review worktree asked to be cleaned up says so, and whether it is done; one removed by hand is forgotten", async () => {
  const root = await tmp();
  const origin = path.join(root, "origin.git");
  const primary = path.join(root, "r", "main");
  await run("git", ["init", "--bare", "-b", "main", origin]);
  await fs.mkdir(primary, { recursive: true });
  await run("git", ["init", "-b", "main", primary]);
  await git(primary, "commit", "--allow-empty", "-m", "base");
  await git(primary, "remote", "add", "origin", "https://github.com/o/r.git");
  // review-6 by the name from before the repository's name was in it.
  for (const name of ["review-r-5", "review-6", "review-r-7"]) await git(primary, "worktree", "add", "--detach", path.join(root, "r", name), "HEAD");
  const file = path.join(root, "watched.json");
  await fs.writeFile(file, JSON.stringify({ paths: [primary] }));

  const asked = Date.parse("2026-11-17T10:00:00Z");
  const cleanups = new Cleanups({ file: path.join(root, "cleanups.json"), log: () => {}, now: () => asked });
  await cleanups.follow("o/r", 5, "merge");
  await cleanups.follow("o/r", 6, "sendBack");
  await cleanups.follow("o/r", 8, "merge");

  const pr = (number: number, over: Record<string, unknown> = {}) => ({
    number,
    title: `t${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    state: "OPEN",
    headRefName: `feat/${number}`,
    isCrossRepository: true,
    repository: { nameWithOwner: "o/r" },
    ...over,
  });
  const github: GitHubRead = async (args) => {
    const query = args[args.indexOf("-f") + 1] ?? "";
    if (!query.includes("search(")) return { stdout: JSON.stringify({ data: { r0: { nameWithOwner: "o/r" } } }) };
    return {
      stdout: JSON.stringify({
        data: {
          req: { issueCount: 0, nodes: [] },
          w0: { issueCount: 0, nodes: [] },
          l0: {
            p5: pr(5, { state: "MERGED" }),
            p6: pr(6, { changes: { nodes: [{ viewerDidAuthor: true, submittedAt: "2026-11-17T09:00:00Z" }] } }),
            p7: pr(7),
            p8: pr(8),
          },
        },
      }),
    };
  };
  const reviewer = new Reviewer({ exec, folders: () => [primary], file, log: () => {}, now: () => asked, cleanups });
  const listing = await reviewer.list(github, "", false);
  assert.deepEqual(listing.errors, []);
  const byNumber = Object.fromEntries(listing.repos.flatMap((r) => r.prs).map((p) => [p.number, p.place?.cleanup]));
  assert.deepEqual(byNumber, { 5: { kind: "merge", done: true }, 6: { kind: "sendBack", done: false }, 7: undefined });
  // The page's spots carry it.
  assert.deepEqual(pageItems([{ machine: "m", listing }]).groups[0]?.items.find((i) => i.pr.number === 5)?.spots[0]?.cleanup, { kind: "merge", done: true });
  // #8 has no review worktree here (removed by hand): forgotten.
  assert.deepEqual((await cleanups.all()).map((e) => e.number), [5, 6]);
});
