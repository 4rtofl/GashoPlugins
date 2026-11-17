import assert from "node:assert/strict";
import { test } from "node:test";
import type { MachineInfo, WorktreeListContext, WorktreeListWorktree } from "@gasho/plugin-sdk";
import { forget, headingCategories, MAX_PLACED, place, type Heading, type Placed } from "../src/web/headings.ts";

const machine: MachineInfo = { id: "mac", name: "mac", connected: true, lastSeen: 0, sessions: [] };
const key = (path: string) => `mac\u001f${path}`;
const worktree = (path: string): WorktreeListWorktree => ({
  key: key(path),
  machine,
  path,
  repo: path,
  repoName: path.split("/").pop(),
  sessions: [],
  registered: false,
  status: "unknown",
});
const ctx = (...paths: string[]): WorktreeListContext => ({ machines: [machine], worktrees: paths.map(worktree) });
const shown = (cs: ReturnType<typeof headingCategories>) => cs.map((c) => `${c.title}: ${c.worktrees.map((w) => w.key.split("\u001f")[1]).join(",")}`);

const HEADINGS: Heading[] = [
  { id: "doing", title: "進行中" },
  { id: "review", title: "レビュー待ち" },
  { id: "done", title: "完了" },
];

test("a category per heading in their order, empty ones too; worktrees in no heading, or in a removed one, are left to 「その他」", () => {
  const placed: Placed = { [key("/a")]: "review", [key("/b")]: "doing", [key("/c")]: "review", [key("/d")]: "removed" };
  const got = headingCategories(HEADINGS, placed, ctx("/c", "/a", "/b", "/d", "/e"));
  // In a heading, Gasho's order (the one used last first), not the order they were put in.
  assert.deepEqual(shown(got), ["進行中: /b", "レビュー待ち: /c,/a", "完了: "]);
  // The ids are the headings' (Gasho keeps the dragged order and the folding by them), and Gasho's second line stays.
  assert.deepEqual(
    got.map((c) => c.id),
    ["doing", "review", "done"],
  );
  assert.ok(got.every((c) => c.worktrees.every((w) => !("description" in w))));
  // A worktree put in a heading but not listed (another repository picked in the sidebar) is not given to Gasho.
  assert.deepEqual(shown(headingCategories(HEADINGS, placed, ctx("/e"))), ["進行中: ", "レビュー待ち: ", "完了: "]);
});

test("dropping a row puts the worktree in that heading, last; dropping it in 「その他」 takes it out", () => {
  const listed = new Set([key("/a"), key("/b")]);
  let placed: Placed = {};
  placed = place(placed, { worktree: key("/a"), from: null, to: "doing", index: 0 }, listed);
  placed = place(placed, { worktree: key("/b"), from: null, to: "doing", index: 1 }, listed);
  placed = place(placed, { worktree: key("/a"), from: "doing", to: "review", index: 0 }, listed);
  assert.deepEqual(Object.entries(placed), [
    [key("/b"), "doing"],
    [key("/a"), "review"],
  ]);
  assert.deepEqual(place(placed, { worktree: key("/b"), from: "doing", to: null, index: 0 }, listed), { [key("/a")]: "review" });
});

test("past MAX_PLACED, the worktrees put longest ago that the sidebar does not list are forgotten, the listed ones kept", () => {
  const placed: Placed = {};
  for (let i = 0; i < MAX_PLACED; i++) placed[key(`/w${i}`)] = "done";
  // The oldest is listed: it stays, and the oldest one not listed goes.
  const got = place(placed, { worktree: key("/new"), from: null, to: "doing", index: 0 }, new Set([key("/w0"), key("/new")]));
  assert.equal(Object.keys(got).length, MAX_PLACED);
  assert.equal(got[key("/w0")], "done");
  assert.equal(got[key("/w1")], undefined);
  assert.equal(got[key("/w2")], "done");
  assert.equal(got[key("/new")], "doing");
});

test("removing a heading takes its worktrees out of every heading", () => {
  const placed: Placed = { [key("/a")]: "review", [key("/b")]: "doing", [key("/c")]: "review" };
  assert.deepEqual(forget(placed, "review"), { [key("/b")]: "doing" });
});
