import assert from "node:assert/strict";
import { test } from "node:test";
import type { MachineInfo, SessionInfo, SessionStatus, WorktreeListContext, WorktreeListWorktree } from "@gasho/plugin-sdk";
import { stateOf, statusCategories } from "../src/web/status.ts";

const machine = (id: string, connected = true): MachineInfo => ({ id, name: id, connected, lastSeen: 0, sessions: [] });
const session = (sessionId: string, status: SessionStatus): SessionInfo => ({ sessionId, cwd: "/repos/x", status, rcMode: "server", prLinks: [], managed: true });

/**
 * A worktree as Gasho gives it: its row's state is the most pressing of its sessions' (Gasho works it out), unknown
 * offline and without sessions.
 */
function worktree(path: string, sessions: SessionStatus[], m = machine("mac")): WorktreeListWorktree {
  const status = !m.connected ? "unknown" : ((["waiting", "busy", "idle"] as const).find((s) => sessions.includes(s)) ?? "unknown");
  return {
    key: `${m.id}\u001f${path}`,
    machine: m,
    path,
    repo: path,
    repoName: path.split("/").pop(),
    sessions: sessions.map((s, i) => session(`${path}#${i}`, s)),
    registered: false,
    status,
  };
}

const shown = (cs: ReturnType<typeof statusCategories>) => cs.map((c) => `${c.title}: ${c.worktrees.map((w) => w.key.split("\u001f")[1]).join(",")}`);

test("the worktrees go in 確認待ち, 作業中, 待機中, オフライン and セッションなし, in that order, and empty ones are left out", () => {
  const offline = machine("pc", false);
  const ctx: WorktreeListContext = {
    machines: [machine("mac"), offline],
    // Gasho's order: the one used last first.
    worktrees: [
      worktree("/repos/a", ["idle", "busy"]),
      worktree("/repos/b", ["idle"]),
      worktree("/repos/c", ["busy", "waiting"]),
      worktree("/repos/d", ["busy"]),
      worktree("/repos/e", ["busy"], offline),
      worktree("/repos/f", []),
      worktree("/repos/g", [], offline),
    ],
  };
  const got = statusCategories(ctx);
  assert.deepEqual(shown(got), [
    "確認待ち: /repos/c",
    "作業中: /repos/a,/repos/d",
    "待機中: /repos/b",
    "オフライン: /repos/e",
    "セッションなし: /repos/f,/repos/g",
  ]);
  // The ids stay whatever is in them: Gasho keeps the dragged order and the folding by them.
  assert.deepEqual(
    got.map((c) => c.id),
    ["waiting", "busy", "idle", "offline", "none"],
  );
  // The rows keep Gasho's second line (the repository's name): no description is given.
  assert.ok(got.every((c) => c.worktrees.every((w) => !("description" in w))));
  assert.ok(got.every((c) => c.hint && !c.launch));

  // Nothing waits and nothing is offline: those categories are not there.
  assert.deepEqual(shown(statusCategories({ machines: ctx.machines, worktrees: [worktree("/repos/b", ["idle"]), worktree("/repos/d", ["busy"])] })), [
    "作業中: /repos/d",
    "待機中: /repos/b",
  ]);
  assert.deepEqual(statusCategories({ machines: ctx.machines, worktrees: [] }), []);
});

test("a worktree's category: without sessions first, then offline, then its row's state (unknown counts as idle)", () => {
  assert.equal(stateOf(worktree("/x", [])), "none");
  assert.equal(stateOf(worktree("/x", [], machine("pc", false))), "none");
  assert.equal(stateOf(worktree("/x", ["waiting"], machine("pc", false))), "offline");
  assert.equal(stateOf(worktree("/x", ["idle", "waiting", "busy"])), "waiting");
  assert.equal(stateOf(worktree("/x", ["idle", "busy"])), "busy");
  assert.equal(stateOf(worktree("/x", ["idle"])), "idle");
  assert.equal(stateOf(worktree("/x", ["unknown"])), "idle");
});
