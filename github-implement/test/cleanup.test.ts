import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionInfo } from "@gasho/plugin-sdk";
import headOid from "../src/daemon/detail/head-oid.ts";
import { detailArgs, parseDetail } from "../src/daemon/gh.ts";
import { changesText, isMergedHeadWorktree, pushedOf, sessionName, sessionsIn } from "../src/web/item/cleanup.ts";
import type { GitHubItemDetail, WorktreeItems } from "../src/types.ts";

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
