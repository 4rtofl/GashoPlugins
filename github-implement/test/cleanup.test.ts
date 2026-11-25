import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { SessionInfo } from "@gasho/plugin-sdk";
import type { DaemonContext } from "@gasho/plugin-sdk/daemon";
import { begin, end } from "../src/daemon/core.ts";
import headOid from "../src/daemon/detail/head-oid.ts";
import { detailArgs, parseDetail } from "../src/daemon/gh.ts";
import autoRemove from "../src/daemon/ops/auto-remove.ts";
import itemsOp from "../src/daemon/ops/items.ts";
import merged from "../src/daemon/ops/merged.ts";
import { changesText, dueForRemoval, isMergedHeadWorktree, pushedOf, sessionName, sessionsIn } from "../src/web/item/cleanup.ts";
import type { GitHubItemDetail, MergedWorktree, WorktreeItems } from "../src/types.ts";

const pull = (over: Partial<GitHubItemDetail> = {}): GitHubItemDetail => ({
  kind: "pulls",
  number: 7,
  title: "t",
  url: "https://github.com/o/r/pull/7",
  createdAt: "",
  updatedAt: "",
  labels: [],
  state: "merged",
  assignees: [],
  body: "",
  head: "feat/7",
  base: "main",
  ...over,
});

const tree = { path: "/home/u/r-feat", branch: "feat/7", repo: "/home/u/r" };
const items: WorktreeItems = { pulls: [{ kind: "pulls", number: 7, title: "t", state: "merged", url: "https://github.com/o/r/pull/7" }], added: [], missing: [], at: 0 };

test("only a merged pull request opened in its head branch's worktree, not the main one, offers the removal", () => {
  assert.equal(isMergedHeadWorktree(pull(), tree, items), true);
  assert.equal(isMergedHeadWorktree(pull(), { ...tree, path: "/home/u/r-feat/" }, items), true);
  assert.equal(isMergedHeadWorktree(pull({ state: "open" }), tree, items), false);
  assert.equal(isMergedHeadWorktree(pull({ state: "closed" }), tree, items), false);
  assert.equal(isMergedHeadWorktree(pull({ kind: "issues" }), tree, items), false);
  assert.equal(isMergedHeadWorktree(pull(), { ...tree, branch: "other" }, items), false);
  assert.equal(isMergedHeadWorktree(pull(), { ...tree, branch: undefined }, items), false);
  // The repository's main worktree, even with the head branch checked out, and a folder outside a repository.
  assert.equal(isMergedHeadWorktree(pull(), { ...tree, path: "/home/u/r" }, items), false);
  assert.equal(isMergedHeadWorktree(pull(), { ...tree, path: "/home/u/r/", repo: "/home/u/r" }, items), false);
  assert.equal(isMergedHeadWorktree(pull(), { ...tree, repo: undefined }, items), false);
  assert.equal(isMergedHeadWorktree(pull({ head: undefined }), tree, items), false);
  // One merged before from a branch of the same name, or from a fork's: the worktree's items do not count it, even
  // when it was added by hand. Nor before they are read.
  assert.equal(isMergedHeadWorktree(pull(), tree, { ...items, pulls: [], added: items.pulls }), false);
  assert.equal(isMergedHeadWorktree(pull(), tree, undefined), false);
});

test("the sessions that end are those in the worktree's folder or below it", () => {
  const s = (sessionId: string, cwd: string, name?: string) => ({ sessionId, cwd, ...(name ? { name } : {}) }) as SessionInfo;
  const sessions = [s("a", "/home/u/r-feat"), s("b", "/home/u/r-feat/sub"), s("c", "/home/u/r-feat2"), s("d", "/home/u/r")];
  assert.deepEqual(
    sessionsIn({ sessions }, "/home/u/r-feat").map((x) => x.sessionId),
    ["a", "b"],
  );
  assert.equal(sessionName({ sessionId: "0123456789", name: " 実装 " }), "実装");
  assert.equal(sessionName({ sessionId: "0123456789", title: "Fix" }), "Fix");
  assert.equal(sessionName({ sessionId: "0123456789" }), "01234567");
});

test("the refusal says how many changes would be lost", () => {
  assert.equal(changesText({ uncommitted: 2, unpushed: 0 }), "未コミットの変更が 2 件あります。");
  assert.equal(changesText({ uncommitted: 0, unpushed: 1 }), "push していない commit が 1 件あります。");
  assert.equal(changesText({ uncommitted: 3, unpushed: 4 }), "未コミットの変更が 3 件と、push していない commit が 4 件あります。");
});

test("the head commit goes as pushed when GitHub gave it", () => {
  assert.deepEqual(pushedOf({ headOid: "a".repeat(40) }), ["a".repeat(40)]);
  assert.equal(pushedOf({}), undefined);
});

test("a pull request's head commit is read with it (headRefOid)", () => {
  assert.ok(detailArgs("o/r", "pulls", 7, [headOid]).at(-1)?.split(",").includes("headRefOid"));
  assert.ok(!detailArgs("o/r", "issues", 7, [headOid]).at(-1)?.split(",").includes("headRefOid"));
  const raw = { number: 7, title: "t", url: "https://github.com/o/r/pull/7", state: "MERGED", headRefName: "feat/7" };
  assert.equal(parseDetail(JSON.stringify({ ...raw, headRefOid: "AB".repeat(20) }), "pulls", [headOid])?.headOid, "ab".repeat(20));
  assert.equal(parseDetail(JSON.stringify({ ...raw, headRefOid: "not a sha" }), "pulls", [headOid])?.headOid, undefined);
});

test("a merged worktree is removed without asking once nobody used it for the minutes set, and no session in it is at work", () => {
  const min = 60_000;
  const w = { seenAt: 0 };
  const idle = (lastActivityAt?: number, over: Partial<SessionInfo> = {}) => ({ status: "idle", ...(lastActivityAt === undefined ? {} : { lastActivityAt }), ...over }) as SessionInfo;
  assert.equal(dueForRemoval(w, [], 30, 30 * min), true);
  assert.equal(dueForRemoval(w, [], 30, 30 * min - 1), false);
  // 0 turns it off.
  assert.equal(dueForRemoval(w, [], 0, 999 * min), false);
  // Used is the latest of the sessions' activity (or start) and when Gasho showed it.
  assert.equal(dueForRemoval(w, [idle(10 * min), idle(2 * min)], 30, 39 * min), false);
  assert.equal(dueForRemoval(w, [idle(10 * min), idle(2 * min)], 30, 40 * min), true);
  assert.equal(dueForRemoval(w, [idle(undefined, { startedAt: 10 * min })], 30, 39 * min), false);
  assert.equal(dueForRemoval({ seenAt: 10 * min }, [idle(0)], 30, 39 * min), false);
  // A session at work or waiting for an answer keeps it, however long ago it was used.
  for (const over of [{ status: "busy" }, { status: "waiting" }, { pendingInputs: 1 }, { background: [{}] }] as Partial<SessionInfo>[]) {
    assert.equal(dueForRemoval(w, [idle(0), idle(0, over)], 30, 999 * min), false, JSON.stringify(over));
  }
  // One that was not removed is tried again only once it is used after that.
  const refused = { seenAt: 0, notRemoved: { problem: "未コミットの変更が 1 件あります。", at: 5 * min } };
  assert.equal(dueForRemoval(refused, [idle(4 * min)], 30, 999 * min), false);
  assert.equal(dueForRemoval(refused, [idle(6 * min)], 30, 36 * min), true);
});

test("the merged worktrees are those shown in the last day whose branch's pull request is merged at their HEAD, and one page at a time removes each", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "implement-merged-"));
  const head = "a".repeat(40);
  const recent = Date.now() - 60_000;
  const kept = (branch: string, over: object = {}) => ({ repo: "o/r", branch, added: [], seenAt: recent, repoDir: "/r", ...over });
  await fs.writeFile(
    path.join(dir, "worktrees.json"),
    JSON.stringify({
      worktrees: {
        "/r-feat": kept("feat/7-x"),
        "/r-open": kept("feat/8-y"),
        // Another branch checked out since it was shown, github-review's review worktree, the main one, and one shown days ago.
        "/r-moved": kept("feat/7-x"),
        "/review-r-7": kept("feat/7-x"),
        "/r": kept("feat/7-x"),
        "/r-old": kept("feat/7-x", { seenAt: recent - 2 * 24 * 60 * 60_000 }),
        // Shown before the screen said where its repository is: its HEAD cannot be found yet.
        "/r-nodir": kept("feat/7-x", { repoDir: undefined }),
      },
    }),
  );
  const listing = (p: string, branch: string, sha = head) => [`worktree ${p}`, `HEAD ${sha}`, `branch refs/heads/${branch}`, ""];
  const porcelain = [...listing("/r", "main", "e".repeat(40)), ...listing("/r-feat", "feat/7-x"), ...listing("/r-open", "feat/8-y"), ...listing("/r-moved", "other"), ...listing("/review-r-7", "feat/7-x"), ...listing("/r-old", "feat/7-x"), ...listing("/r-nodir", "feat/7-x")].join("\n");
  const node = (number: number, state: string) => ({ __typename: "PullRequest", number, title: `#${number}`, state, url: `https://github.com/o/r/pull/${number}`, isCrossRepository: false, headRefOid: head, updatedAt: "2026-11-25T00:00:00Z" });
  let gitRuns = 0;
  const ctx = {
    folders: () => ["/r"],
    exec: async () => (gitRuns++, { stdout: porcelain, stderr: "" }),
    github: {
      read: async (args: string[]) => {
        const branch = args.find((a) => a.startsWith("branch="))?.slice("branch=".length);
        const nodes = branch === "feat/7-x" ? [node(7, "MERGED")] : [node(8, "OPEN")];
        return { stdout: JSON.stringify({ data: { repository: { pulls: { nodes } } } }), stderr: "" };
      },
    },
    log: () => undefined,
  } as unknown as DaemonContext;
  begin(dir, {}, () => undefined);
  try {
    const list = async () => (await merged.run({}, ctx)) as { now: number; worktrees: MergedWorktree[] };
    const first = await list();
    assert.deepEqual(first.worktrees, [{ path: "/r-feat", repoDir: "/r", branch: "feat/7-x", repo: "o/r", number: 7, head, seenAt: recent }]);
    // One git run for the repository, however many of its worktrees.
    assert.equal(gitRuns, 1);
    // What the asking page shows is used now.
    const shown = (await merged.run({ shown: ["/r-feat"] }, ctx)) as { now: number; worktrees: MergedWorktree[] };
    assert.ok((shown.worktrees[0]?.seenAt ?? 0) >= shown.now);

    const write = (params: object) => autoRemove.run({ worktree: "/r-feat", ...params });
    assert.deepEqual(await write({ action: "claim" }), { claimed: true });
    assert.deepEqual(await write({ action: "claim" }), { claimed: false });
    await write({ action: "failed", problem: "未コミットの変更が 1 件あります。" });
    assert.equal((await list()).worktrees[0]?.notRemoved?.problem, "未コミットの変更が 1 件あります。");
    // The merged section reads why with the worktree's items, also once it is shown again on the same branch.
    const items = (await itemsOp.run({ repo: "o/r", branch: "feat/7-x", worktree: "/r-feat", repoDir: "/r" }, ctx)) as WorktreeItems;
    assert.equal(items.notRemoved?.problem, "未コミットの変更が 1 件あります。");
    assert.deepEqual(await write({ action: "claim" }), { claimed: true });
    await write({ action: "removed" });
    assert.deepEqual((await list()).worktrees, []);
    await assert.rejects(write({ action: "other" }));
  } finally {
    end();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
