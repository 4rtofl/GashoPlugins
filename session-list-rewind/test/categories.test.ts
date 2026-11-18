import assert from "node:assert/strict";
import { test } from "node:test";
import type { MachineInfo, SessionInfo, SessionListContext, SessionListWorktree } from "@gasho/plugin-sdk";
import { categories } from "../src/web/categories.ts";

const machine = (id: string): MachineInfo => ({ id, name: id, connected: true, lastSeen: 0, sessions: [] });
const session = (sessionId: string, cwd: string): SessionInfo => ({ sessionId, cwd, status: "idle", rcMode: "server", prLinks: [], managed: true });

/** A worktree as Gasho gives it: `repo` is its repository's folder, absent outside a repository. */
function worktree(m: MachineInfo, path: string, extra: Partial<SessionListWorktree> = {}): SessionListWorktree {
  return { key: `${m.id}\u001f${path}`, machine: m, path, sessions: [], registered: false, ...extra };
}

/** The context, with the sessions given as [id, worktree, last used], in any order (Gasho sorts them, last used first). */
function context(machines: MachineInfo[], worktrees: SessionListWorktree[], sessions: [string, SessionListWorktree, number][]): SessionListContext {
  return {
    machines,
    worktrees,
    sessions: sessions
      .map(([id, w, lastUsed]) => ({ machine: w.machine, session: session(id, w.path), worktree: w.key, lastUsed }))
      .sort((a, b) => b.lastUsed - a.lastUsed),
  };
}

const ids = (cs: ReturnType<typeof categories>) => cs.map((c) => `${c.title}: ${c.sessions.map((s) => s.sessionId).join(",")}`);

const mac = machine("mac");
const gasho = worktree(mac, "/repos/Gasho", { repo: "/repos/Gasho", branch: "main", repoName: "Gasho" });
const gashoFeat = worktree(mac, "/tmp/wt/feat", { repo: "/repos/Gasho", branch: "feat/x", repoName: "Gasho" });
const plugins = worktree(mac, "/repos/GashoPlugins", { repo: "/repos/GashoPlugins", branch: "main", repoName: "GashoPlugins" });

test("one category per repository, the one used last first, and its sessions too", () => {
  const got = categories(
    context([mac], [gasho, plugins], [
      ["a", gasho, 100],
      ["b", plugins, 300],
      ["c", gasho, 200],
      ["d", plugins, 50],
    ]),
  );
  assert.deepEqual(ids(got), ["GashoPlugins: b,d", "Gasho: c,a"]);
  // The id stays whatever the order: the working server and the repository's folder.
  assert.deepEqual(got.map((c) => c.id), ["mac\u001f/repos/GashoPlugins", "mac\u001f/repos/Gasho"]);
  // One working server: no name after the title. The hint tells where it is.
  assert.equal(got[0]!.description, undefined);
  assert.equal(got[0]!.hint, "mac · /repos/GashoPlugins");
  // All in one worktree: no second line.
  assert.ok(got.every((c) => c.sessions.every((s) => s.description === undefined)));
});

test("the worktrees of a repository are one category, and then each session tells its worktree's branch", () => {
  const detached = worktree(mac, "/tmp/wt/detached", { repo: "/repos/Gasho", repoName: "Gasho" });
  const got = categories(
    context([mac], [gashoFeat, gasho, detached], [
      ["a", gashoFeat, 300],
      ["b", gasho, 200],
      ["c", detached, 100],
    ]),
  );
  assert.deepEqual(ids(got), ["Gasho: a,b,c"]);
  assert.deepEqual(
    got[0]!.sessions.map((s) => s.description),
    // HEAD detached: the folder's name.
    ["feat/x", "main", "detached"],
  );
  // "＋" starts in the main worktree (the repository's folder), even though another was used last.
  assert.equal(got[0]!.launch, gasho.key);
});

test("without its main worktree (a bare repository), the category's \"＋\" starts in the worktree used last", () => {
  const a = worktree(mac, "/srv/app/a", { repo: "/srv/app.git", branch: "a", repoName: "app" });
  const b = worktree(mac, "/srv/app/b", { repo: "/srv/app.git", branch: "b", repoName: "app" });
  const got = categories(context([mac], [a, b], [["x", a, 1], ["y", b, 2]]));
  assert.equal(got[0]!.launch, b.key);
  assert.equal(got[0]!.title, "app");
});

test("outside a repository, one category per folder, named after it", () => {
  const scratch = worktree(mac, "/home/me/scratch");
  const notes = worktree(mac, "/home/me/notes");
  const got = categories(context([mac], [scratch, notes], [["a", scratch, 2], ["b", notes, 1], ["c", scratch, 3]]));
  assert.deepEqual(ids(got), ["scratch: c,a", "notes: b"]);
  assert.equal(got[0]!.launch, scratch.key);
});

test("the same repository on two working servers is two categories, with the server's name", () => {
  const ubuntu = machine("ubuntu");
  const there = worktree(ubuntu, "/repos/Gasho", { repo: "/repos/Gasho", branch: "main", repoName: "Gasho" });
  const got = categories(context([mac, ubuntu], [gasho, there], [["a", gasho, 1], ["b", there, 2]]));
  assert.deepEqual(
    got.map((c) => [c.title, c.description, c.sessions.map((s) => s.sessionId).join()]),
    [
      ["Gasho", "ubuntu", "b"],
      ["Gasho", "mac", "a"],
    ],
  );
  assert.notEqual(got[0]!.id, got[1]!.id);
});

test("a registered repository without a session has its category after the others, for its \"＋\"", () => {
  const daichoo = worktree(mac, "/repos/Daichoo", { repo: "/repos/Daichoo", branch: "main", repoName: "Daichoo", registered: true });
  const daichooFeat = worktree(mac, "/repos/Daichoo-x", { repo: "/repos/Daichoo", branch: "x", repoName: "Daichoo", registered: true });
  // A worktree of a registered repository that has sessions: its category is where its sessions put it.
  const gashoRegistered = { ...gasho, registered: true };
  const got = categories(context([mac], [gashoRegistered, daichoo, daichooFeat], [["a", gashoRegistered, 1]]));
  assert.deepEqual(ids(got), ["Gasho: a", "Daichoo: "]);
  assert.equal(got[1]!.launch, daichoo.key);
});

test("headings of the same name on a working server tell the folder they are in", () => {
  // A session in the folder that holds the repository GashoPlugins and its worktrees (not a repository itself).
  const container = worktree(mac, "/u/Project/GashoPlugins");
  const inner = worktree(mac, "/u/Project/GashoPlugins/GashoPlugins", { repo: "/u/Project/GashoPlugins/GashoPlugins", branch: "main", repoName: "GashoPlugins" });
  const got = categories(context([mac], [container, inner, gasho], [["a", container, 3], ["b", inner, 2], ["c", gasho, 1]]));
  assert.deepEqual(
    got.map((c) => `${c.title} ${c.description ?? "-"}`),
    ["GashoPlugins …/Project", "GashoPlugins …/GashoPlugins", "Gasho -"],
  );

  // On two working servers, the server's name comes first; the same name on another server is told by it alone.
  const ubuntu = machine("ubuntu");
  const there = worktree(ubuntu, "/u/Project/GashoPlugins/GashoPlugins", { repo: "/u/Project/GashoPlugins/GashoPlugins", repoName: "GashoPlugins" });
  assert.deepEqual(
    categories(context([mac, ubuntu], [container, inner, there], [["a", container, 3], ["b", inner, 2], ["c", there, 1]])).map((c) => c.description),
    ["mac · …/Project", "mac · …/GashoPlugins", "ubuntu"],
  );
});

test("no session and nothing registered: no category", () => {
  assert.deepEqual(categories(context([mac], [], [])), []);
});
