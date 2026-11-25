import assert from "node:assert/strict";
import { test } from "node:test";
import type { MachineInfo, SessionInfo, WorktreeListContext, WorktreeListWorktree } from "@gasho/plugin-sdk";
import { repoCategories } from "../src/web/repo.ts";

const machine = (id: string): MachineInfo => ({ id, name: id, connected: true, lastSeen: 0, sessions: [] });
const session = (sessionId: string, cwd: string): SessionInfo => ({ sessionId, cwd, status: "idle", rcMode: "server", prLinks: [], managed: true });

/** A worktree as Gasho gives it: `repo` is its repository's folder, absent outside a repository. */
function worktree(m: MachineInfo, path: string, extra: Partial<WorktreeListWorktree> = {}): WorktreeListWorktree {
  return { key: `${m.id}\u001f${path}`, machine: m, path, sessions: [], registered: false, status: "unknown", ...extra };
}

/** A worktree with a session, used at `lastUsed`. */
const used = (w: WorktreeListWorktree, lastUsed: number): WorktreeListWorktree => ({ ...w, sessions: [session(`s${lastUsed}`, w.path)], status: "idle", lastUsed });

/** The context: Gasho gives the worktrees the one used last first, then those without sessions. */
const context = (machines: MachineInfo[], worktrees: WorktreeListWorktree[]): WorktreeListContext => ({ machines, worktrees });

const shown = (cs: ReturnType<typeof repoCategories>) => cs.map((c) => `${c.title}: ${c.worktrees.map((w) => w.key.split("\u001f")[1]).join(",")}`);

const mac = machine("mac");
const gasho = worktree(mac, "/repos/Gasho", { repo: "/repos/Gasho", branch: "main", repoName: "Gasho" });
const gashoFeat = worktree(mac, "/tmp/wt/feat", { repo: "/repos/Gasho", branch: "feat/x", repoName: "Gasho" });
const plugins = worktree(mac, "/repos/GashoPlugins", { repo: "/repos/GashoPlugins", branch: "main", repoName: "GashoPlugins" });
const bobert = worktree(mac, "/repos/Bobert", { repo: "/repos/Bobert", branch: "main", repoName: "Bobert", registered: true });

test("one category per repository, in the order its worktrees were last used, and its worktrees in Gasho's order", () => {
  const got = repoCategories(context([mac], [used(gashoFeat, 300), used(plugins, 200), used(gasho, 100), bobert]));
  assert.deepEqual(shown(got), ["Gasho: /tmp/wt/feat,/repos/Gasho", "GashoPlugins: /repos/GashoPlugins", "Bobert: /repos/Bobert"]);
  // The id stays whatever the order: the working server and the repository's folder.
  assert.deepEqual(
    got.map((c) => c.id),
    ["mac\u001f/repos/Gasho", "mac\u001f/repos/GashoPlugins", "mac\u001f/repos/Bobert"],
  );
  // One working server: no name after the title. The hint tells where it is.
  assert.equal(got[0]!.description, undefined);
  assert.equal(got[0]!.hint, "mac · /repos/Gasho");
  // The heading names the repository: the rows have no second line.
  assert.ok(got.every((c) => c.worktrees.every((w) => w.description === "")));
});

test("「＋」 starts in the repository's main worktree, else in the one used last", () => {
  const got = repoCategories(context([mac], [used(gashoFeat, 300), used(gasho, 100)]));
  assert.equal(got[0]!.launch, gasho.key);
  // A bare repository: its folder is no worktree.
  const bareA = worktree(mac, "/wt/a", { repo: "/repos/bare.git", repoName: "bare" });
  const bareB = worktree(mac, "/wt/b", { repo: "/repos/bare.git", repoName: "bare" });
  assert.equal(repoCategories(context([mac], [used(bareB, 200), used(bareA, 100)]))[0]!.launch, bareB.key);
  // A repository without a name of its own is named by its folder.
  assert.equal(repoCategories(context([mac], [{ ...bareA, repoName: undefined }]))[0]!.title, "bare.git");
});

test("the folders outside a repository go in one category per working server, with no 「＋」", () => {
  const notes = worktree(mac, "/home/me/notes");
  const tmp = worktree(mac, "/tmp/scratch");
  const got = repoCategories(context([mac], [used(notes, 300), used(gasho, 200), tmp]));
  assert.deepEqual(shown(got), ["リポジトリの外: /home/me/notes,/tmp/scratch", "Gasho: /repos/Gasho"]);
  assert.equal(got[0]!.id, "mac\u001f\u001foutside");
  assert.equal(got[0]!.launch, undefined);
  assert.equal(got[0]!.hint, "mac · リポジトリの外のフォルダー");
});

test("the same repository on two working servers makes two categories, each named with its working server", () => {
  const pc = machine("pc");
  const gashoPc = worktree(pc, "/repos/Gasho", { repo: "/repos/Gasho", branch: "main", repoName: "Gasho" });
  const got = repoCategories(context([mac, pc], [used(gashoPc, 300), used(gasho, 200), worktree(pc, "/tmp/x")]));
  assert.deepEqual(
    got.map((c) => `${c.title} (${c.description}) ${c.id}`),
    ["Gasho (pc) pc\u001f/repos/Gasho", "Gasho (mac) mac\u001f/repos/Gasho", "リポジトリの外 (pc) pc\u001f\u001foutside"],
  );
});

test("a worktree with its repository's name but not its folder goes in that repository's category, or in one of its name", () => {
  // From an older gasho-daemon, or remembered by a Gasho that did not keep the folder yet.
  const old = worktree(mac, "/tmp/wt/old", { repoName: "Gasho", branch: "fix/y" });
  const got = repoCategories(context([mac], [used(old, 300), used(gasho, 200)]));
  assert.deepEqual(shown(got), ["Gasho: /tmp/wt/old,/repos/Gasho"]);
  assert.equal(got[0]!.id, "mac\u001f/repos/Gasho");
  assert.equal(got[0]!.launch, gasho.key);

  // Its working server has no repository of that name: a category of the name, started in the worktree used last.
  const alone = worktree(mac, "/tmp/wt/alone", { repoName: "Bobert" });
  const named = repoCategories(context([mac], [used(alone, 300), used(gasho, 200)]));
  assert.deepEqual(shown(named), ["Bobert: /tmp/wt/alone", "Gasho: /repos/Gasho"]);
  assert.equal(named[0]!.id, "mac\u001f\u001fname\u001fBobert");
  assert.equal(named[0]!.launch, alone.key);
  assert.equal(named[0]!.description, undefined);

  // Two repositories of the name: a category of the name, told apart by a fixed word whatever worktree was used last
  // (one in /u/src would otherwise be told as …/src, as the repository in /u/src is).
  const upstream = worktree(mac, "/u/src/Gasho", { repo: "/u/src/Gasho", repoName: "Gasho" });
  const fork = worktree(mac, "/u/fork/Gasho", { repo: "/u/fork/Gasho", repoName: "Gasho" });
  const inSrc = worktree(mac, "/u/src/old", { repoName: "Gasho" });
  const elsewhere = worktree(mac, "/var/old/two", { repoName: "Gasho" });
  for (const last of [inSrc, elsewhere]) {
    assert.deepEqual(
      repoCategories(context([mac], [used(last, 300), used(upstream, 200), used(fork, 100)])).map((c) => `${c.title} ${c.description}`),
      ["Gasho フォルダー不明", "Gasho …/src", "Gasho …/fork"],
    );
  }

  // Another working server's repository of the name is not it.
  const pc = machine("pc");
  const onPc = worktree(pc, "/tmp/wt/old", { repoName: "Gasho" });
  assert.deepEqual(
    repoCategories(context([mac, pc], [used(onPc, 300), used(gasho, 200)])).map((c) => c.id),
    ["pc\u001f\u001fname\u001fGasho", "mac\u001f/repos/Gasho"],
  );
});

test("headings of the same name on a working server tell the folder they are in, as far up as it takes", () => {
  // A fork and its upstream cloned in two folders of the same name.
  const upstream = worktree(mac, "/u/src/Gasho", { repo: "/u/src/Gasho", repoName: "Gasho" });
  const fork = worktree(mac, "/u/fork/Gasho", { repo: "/u/fork/Gasho", repoName: "Gasho" });
  const got = repoCategories(context([mac], [used(upstream, 300), used(fork, 200), used(plugins, 100)]));
  assert.deepEqual(
    got.map((c) => `${c.title} ${c.description ?? "-"}`),
    ["Gasho …/src", "Gasho …/fork", "GashoPlugins -"],
  );

  // The folders they are in have the same name too: one more up. Up to the top, the whole path.
  const a = worktree(mac, "/u/a/x/Gasho", { repo: "/u/a/x/Gasho", repoName: "Gasho" });
  const b = worktree(mac, "/u/b/x/Gasho", { repo: "/u/b/x/Gasho", repoName: "Gasho" });
  const top = worktree(mac, "/Gasho", { repo: "/Gasho", repoName: "Gasho" });
  assert.deepEqual(
    repoCategories(context([mac], [used(a, 300), used(b, 200), used(top, 100)])).map((c) => c.description),
    ["…/a/x", "…/b/x", "/"],
  );

  // Clones side by side in one folder, both named after the repository on GitHub: their own folders' names, without
  // the start they share: Gasho cuts the description at its end, and on a phone only its start shows.
  const descriptions = (folders: string[], name: string) =>
    repoCategories(context([mac], folders.map((f, i) => used(worktree(mac, f, { repo: f, repoName: name }), 300 - i)))).map((c) => c.description);
  assert.deepEqual(descriptions(["/home/u/repos/Gasho", "/home/u/repos/Gasho-fork"], "Gasho"), ["…/Gasho", "…-fork"]);
  assert.deepEqual(descriptions(["/home/u/repos/GashoPlugins", "/home/u/repos/GashoPlugins-fork"], "GashoPlugins"), ["…/GashoPlugins", "…-fork"]);
  assert.deepEqual(
    descriptions(["/home/u/repos/better-worktree-list", "/home/u/repos/better-worktree-list-fork"], "better-worktree-list"),
    ["…/better-worktree-list", "…-fork"],
  );
  // From the word where they differ: at a mark, a capital or a digit.
  assert.deepEqual(descriptions(["/u/repos/Gasho-main", "/u/repos/Gasho-fork"], "Gasho"), ["…-main", "…-fork"]);
  assert.deepEqual(descriptions(["/u/repos/GashoMain", "/u/repos/GashoFork"], "Gasho"), ["…Main", "…Fork"]);
  // With another in a folder of its own, as far up as it takes for all of them, and the fork from where it differs.
  assert.deepEqual(
    descriptions(["/home/u/repos/Gasho", "/home/u/repos/Gasho-fork", "/home/u/other/Gasho"], "Gasho"),
    ["…/repos/Gasho", "…-fork", "…/other/Gasho"],
  );
  // The folders they are in, side by side, are told the same way.
  assert.deepEqual(descriptions(["/u/Project/GashoPlugins/Gasho", "/u/Project/GashoPlugins-fork/Gasho"], "Gasho"), ["…/GashoPlugins", "…-fork"]);

  // On two working servers, the server's name goes after the folder, which is what tells them apart.
  const pc = machine("pc");
  const forkPc = worktree(pc, "/u/fork/Gasho", { repo: "/u/fork/Gasho", repoName: "Gasho" });
  assert.deepEqual(
    repoCategories(context([mac, pc], [used(upstream, 300), used(fork, 200), used(forkPc, 100)])).map((c) => c.description),
    ["…/src · mac", "…/fork · mac", "pc"],
  );
});

test("no worktrees, no categories", () => {
  assert.deepEqual(repoCategories(context([mac], [])), []);
});
