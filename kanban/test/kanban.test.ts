import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { MachineInfo, SessionInfo } from "@gasho/plugin-sdk";
import { arrangeCards, assignSessions, boardCards, cardsOf, issueOf, kanbanCards, placeCard, type BoardPlugins, type SessionLike } from "../src/cards.ts";
import type { FetchContext, FetchRepo } from "../plugins/types.ts";
import { ghError, parseClosed, parseGitHubUrl, parsePrs, parseWorktrees, type Exec, type GitHubRead } from "../src/daemon/git.ts";
import { FETCH_EVERY_MS, READ_EVERY_MS, Reader, type BoardFetchers } from "../src/daemon/reader.ts";
import type { OpenPr, RepoMaterial } from "../src/types.ts";

const pr = (over: Partial<OpenPr> = {}): OpenPr => ({ number: 1, title: "t", url: "https://github.com/o/r/pull/1", headRefName: "feat/1-x", ...over });
const session = (status: SessionLike["status"], cwd = "/r/wt", over: Partial<SessionLike> = {}): SessionLike => ({ sessionId: `s-${status}`, cwd, status, ...over });
const NONE: BoardPlugins = new Map();

test("cards: a worktree without a pull request, a pull request without a worktree, and the primary checkout only when needed", () => {
  const m: RepoMaterial = {
    repo: "o/r",
    primary: { path: "/r/main", branch: "main" },
    worktrees: [
      { branch: "feat/2-a", path: "/r/wt-a" },
      { branch: "feat/3-b", path: "/r/wt-b" },
    ],
    prs: [pr({ number: 9, headRefName: "feat/9-c", title: "C", isDraft: true, updatedAt: "2026-01-01T00:00:00Z" })],
    closed: [{ number: 4, headRefName: "feat/3-b", state: "MERGED", title: "B", url: "https://github.com/o/r/pull/4" }],
  };
  assert.deepEqual(
    cardsOf(m, new Map(), NONE).map((c) => [c.label, c.title, c.issue, c.pr?.state, c.pr?.draft, c.column]),
    [
      ["wt-a", "feat/2-a", 2, undefined, undefined, "mine"],
      ["wt-b", "B", 3, "merged", undefined, "mine"],
      ["PR #9", "C", 9, "open", true, "mine"],
    ],
  );
  // The primary checkout shows while a session there works or awaits an answer; an idle one does not bring it.
  assert.equal(cardsOf(m, new Map([["/r/main", [session("idle", "/r/main")]]]), NONE).some((c) => c.primary), false);
  const busy = cardsOf(m, new Map([["/r/main", [session("busy", "/r/main", { managed: true })]]]), NONE);
  assert.deepEqual(busy.find((c) => c.primary)?.sessions, [{ sessionId: "s-busy", status: "busy", managed: true }]);
  assert.equal(issueOf("release/2.1"), undefined);
});

test("sessions go to the deepest worktree that holds their folder, across the repositories of a working server", () => {
  const byPath = assignSessions([session("busy", "/r/main/sub"), session("idle", "/r/main/wt/x"), session("waiting", "/elsewhere")], ["/r/main", "/r/main/wt"]);
  assert.deepEqual([...byPath].map(([p, ss]) => [p, ss.map((s) => s.status)]), [
    ["/r/main", ["busy"]],
    ["/r/main/wt", ["idle"]],
  ]);
  const s = (id: string, cwd: string, status: SessionInfo["status"], managed = false): SessionInfo => ({ sessionId: id, cwd, status, prLinks: [], managed }) as unknown as SessionInfo;
  const machine = { id: "m", name: "mac", connected: true, lastSeen: 0, sessions: [s("a", "/r/wt-a/src", "busy", true), s("b", "/r/wt-a", "unknown"), s("c", "/r/inner/wt", "waiting")] } as MachineInfo;
  const outer: RepoMaterial = { repo: "o/r", primary: { path: "/r/main" }, worktrees: [{ branch: "feat/2-a", path: "/r/wt-a" }], prs: [], closed: [] };
  const inner: RepoMaterial = { repo: "o/in", primary: { path: "/r/inner" }, worktrees: [{ branch: "x", path: "/r/inner/wt" }], prs: [], closed: [] };
  const board = { watched: ["/r/main", "/r/inner"], repos: [outer, inner], errors: [] };
  assert.deepEqual(
    boardCards(machine, board, NONE).map((c) => [c.label, c.sessions.map((x) => x.sessionId)]),
    [
      ["wt-a", ["a"]],
      ["wt", ["c"]],
    ],
  );
  // An offline working server shows no cards.
  assert.equal(kanbanCards([{ machine: { ...machine, connected: false }, board }], NONE).length, 0);
});

test("a card goes in the column its repository's board plugin gives, with its instructions, and in the first one when the plugin fails", () => {
  const m: RepoMaterial = { repo: "o/r", primary: { path: "/r/main" }, worktrees: [{ branch: "feat/2-a", path: "/r/wt-a" }], prs: [pr({ headRefName: "feat/2-a" })], closed: [], plugin: "mine" };
  const plugins: BoardPlugins = new Map<string, { state?: unknown }>([
    ["mine", { state: (c: { pr?: { number: number } }) => ({ column: "review", reason: ` PR #${c.pr?.number} `, actions: [{ label: " レビューする ", text: `/review ${c.pr?.number}` }] }) }],
    ["blank", { state: () => ({ column: "agent", actions: [{ label: "送る", text: " " }] }) }],
    ["throws", { state: () => { throw new Error("boom"); } }],
    ["odd", { state: () => ({ column: "later" }) }],
    ["empty", {}],
    ["fetched", { state: (_: unknown, fetched?: { ci?: string }) => ({ column: fetched?.ci === "pending" ? "github" : "mine" }) }],
  ]);
  const placed = (name: string | undefined) => {
    const [card] = cardsOf({ ...m, ...(name ? { plugin: name } : { plugin: undefined }) }, new Map(), plugins);
    return [card?.column, card?.reason?.text, card?.reason?.error];
  };
  assert.deepEqual(placed("mine"), ["review", "PR #1", undefined]);
  assert.deepEqual(cardsOf(m, new Map(), plugins)[0]?.actions, [{ label: "レビューする", text: "/review 1" }]);
  assert.deepEqual(placed(undefined), ["mine", undefined, undefined]);
  // An instruction that would send nothing makes the card fail as a whole, so that the plugin's mistake shows.
  assert.deepEqual(placed("blank"), ["mine", "列を決められませんでした（blank）", "state が返した指示を使えません：actions のそれぞれに、空でない label と text が要ります。"]);
  assert.equal(cardsOf({ ...m, plugin: "blank" }, new Map(), plugins)[0]?.actions, undefined);
  assert.deepEqual(placed("throws"), ["mine", "列を決められませんでした（throws）", "state が失敗しました：boom"]);
  assert.deepEqual(placed("odd"), ["mine", "列を決められませんでした（odd）", "state が知らない列を返しました：later"]);
  assert.match(placed("empty")[2] ?? "", /state を export していません/);
  // `state` gets what the plugin's `fetch` gave for the repository.
  assert.equal(cardsOf({ ...m, plugin: "fetched", fetched: { ci: "pending" } }, new Map(), plugins)[0]?.column, "github");
  // A plugin chosen on a working server but not in this build, such as another person's.
  assert.match(placeCard({ id: "x", repo: "o/r", label: "x", title: "", sessions: [] }, "gone", plugins).reason?.error ?? "", /kanban\/plugins\/gone\/ が、このビルドにありません/);
});

test("a column's order: cards without the value stay below in either direction", () => {
  const machine = {} as MachineInfo;
  const rows = [3, undefined, 1].map((issue, i) => ({ machine, card: { id: String(i), repo: "o/r", label: String(i), title: "", column: "mine" as const, sessions: [], ...(issue ? { issue } : {}) } }));
  assert.deepEqual(arrangeCards(rows, { key: "issue", desc: false }).map((r) => r.card.issue), [1, 3, undefined]);
  assert.deepEqual(arrangeCards(rows, { key: "issue", desc: true }).map((r) => r.card.issue), [3, 1, undefined]);
});

test("git's worktree list, GitHub remotes and gh's pull requests are read, and anything odd is left out", () => {
  const porcelain = ["worktree /r/main", "HEAD a", "branch refs/heads/main", "", "worktree /r/wt", "HEAD b", "branch refs/heads/feat/1-x", "", "worktree /r/d", "HEAD c", "detached", ""].join("\n");
  assert.deepEqual(parseWorktrees(porcelain), { primary: { path: "/r/main", branch: "main" }, worktrees: [{ branch: "feat/1-x", path: "/r/wt" }] });
  assert.equal(parseWorktrees("worktree /r/bare.git\nbare\n").primary?.bare, true);
  assert.equal(parseGitHubUrl("git@github.com:4rtoflow/Gasho.git\n"), "4rtoflow/Gasho");
  assert.equal(parseGitHubUrl("https://user:token@github.com/4rtoflow/GashoPlugins"), "4rtoflow/GashoPlugins");
  assert.equal(parseGitHubUrl("https://gitlab.com/a/b.git"), undefined);
  assert.deepEqual(parsePrs([pr({ isDraft: false }), { ...pr(), url: "javascript:alert(1)" }, null]), [pr()]);
  assert.deepEqual(
    parseClosed([
      { number: 4, headRefName: "b", state: "CLOSED", title: "old", url: "https://github.com/o/r/pull/4" },
      { number: 7, headRefName: "b", state: "MERGED", title: "new", url: "https://github.com/o/r/pull/7" },
    ]).map((p) => p.number),
    [7],
  );
  assert.match(ghError({ code: "ENOENT" }), /gh）がありません/);
  assert.match(ghError({ stderr: "To get started with GitHub CLI, please run:  gh auth login" }), /gh auth login を実行/);
});

/** GitHub's rate limit resets then (seconds since the epoch, as the tests' clock counts). */
const RESET = 2_000;

/** A working server with one repository (o/r, at /r/main, with a worktree), its git, and gh as gasho-daemon runs it. */
function fakeServer() {
  const calls: string[] = [];
  /** maxAgeSeconds of each gh call, as `calls` has them. */
  const ages = new Map<number, number | undefined>();
  let ghFails = false;
  let pointsLeft = 5000;
  const exec: Exec = async (command, args) => {
    const at = args.indexOf("-C");
    const cwd = at >= 0 ? args[at + 1] : undefined;
    const rest = at >= 0 ? args.slice(at + 2) : args;
    calls.push([command, ...rest].join(" "));
    if (command !== "git" || !cwd?.startsWith("/r/")) throw Object.assign(new Error("not a git repository"), { code: 128, stdout: "", stderr: "" });
    if (rest[0] === "rev-parse") return { stdout: "/r/main/.git\n", stderr: "" };
    if (rest[0] === "worktree") return { stdout: "worktree /r/main\nbranch refs/heads/main\n\nworktree /r/wt\nbranch refs/heads/feat/5-x\n", stderr: "" };
    return { stdout: "git@github.com:o/r.git\n", stderr: "" };
  };
  const github: GitHubRead = async (args, o) => {
    ages.set(calls.push(["gh", ...args].join(" ")) - 1, o?.maxAgeSeconds);
    if (args[0] === "api" && args[1] === "rate_limit") return { stdout: JSON.stringify({ resources: { graphql: { limit: 5000, remaining: pointsLeft, reset: RESET } } }), stderr: "" };
    if (ghFails) throw Object.assign(new Error("Command failed"), { code: 1, stdout: "", stderr: "error connecting to api.github.com" });
    const state = args[args.indexOf("--state") + 1];
    return { stdout: JSON.stringify(state === "open" ? [pr({ number: 6, headRefName: "feat/5-x" })] : []), stderr: "" };
  };
  return { exec, github, calls, ages, fail: (v: boolean) => (ghFails = v), points: (n: number) => (pointsLeft = n) };
}

test("the watched repositories are kept in the plugin's folder, read at most once a minute, and keep their cards when gh fails", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-"));
  const file = path.join(dir, "watched.json");
  let now = 1_000_000;
  const server = fakeServer();
  const reader = new Reader({ exec: server.exec, github: server.github, folders: () => ["/r/wt", "/elsewhere"], file, log: () => undefined, now: () => now });
  await reader.load();
  assert.deepEqual(await reader.repoOptions(), [{ path: "/r/main", github: "o/r" }]);

  // Only repositories offered can be chosen: never a folder a browser made up.
  await assert.rejects(reader.watch(["/etc"]), /選べない repo/);
  await assert.rejects(reader.watch("/r/main"), /指定が正しくありません/);
  const first = await reader.watch(["/r/main"]);
  assert.equal(first.checking, true);
  await reader.settled();
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), { paths: ["/r/main"], plugins: {} });
  const board = reader.board();
  assert.deepEqual(board.repos[0]?.worktrees, [{ branch: "feat/5-x", path: "/r/wt" }]);
  assert.equal(board.repos[0]?.prs[0]?.number, 6);
  assert.equal(board.checking, undefined);

  // A request within the minute reads nothing; one after it starts the next reading.
  const ghCalls = () => server.calls.filter((c) => c.startsWith("gh")).length;
  const before = ghCalls();
  now += 10_000;
  reader.board();
  assert.equal(ghCalls(), before);
  now += READ_EVERY_MS;
  server.fail(true);
  assert.equal(reader.board().checking, true);
  await reader.settled();
  const failed = reader.board();
  assert.equal(failed.repos[0]?.prs[0]?.number, 6);
  assert.deepEqual(failed.errors.map((e) => [e.repo, e.error]), [["o/r", "GitHub から読み込めませんでした：error connecting to api.github.com"]]);

  // The board plugin of a repository is kept with it, comes with its material, and changing it reads nothing again.
  await assert.rejects(reader.watch(["/r/main"], { "/r/main": 1 }), /プラグインの指定が正しくありません/);
  const chosen = await reader.watch(["/r/main"], { "/r/main": "mine", "/elsewhere": "mine" });
  assert.equal(chosen.checking, undefined);
  assert.deepEqual(chosen.plugins, { "/r/main": "mine" });
  assert.equal(chosen.repos[0]?.plugin, "mine");
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), { paths: ["/r/main"], plugins: { "/r/main": "mine" } });
  // Choosing the repositories without the plugins keeps the ones chosen.
  assert.deepEqual((await reader.watch(["/r/main"])).plugins, { "/r/main": "mine" });

  // Another process (the plugin started again) reads the same repositories from the file.
  const again = new Reader({ exec: server.exec, github: server.github, folders: () => ["/r/wt"], file, log: () => undefined });
  await again.load();
  assert.deepEqual(again.board().watched, ["/r/main"]);
  assert.deepEqual(again.board().plugins, { "/r/main": "mine" });
  await again.settled();
  // A repository watched before may stay while its folder is gone, so that it can be taken off.
  const gone = new Reader({ exec: server.exec, github: server.github, folders: () => [], file, log: () => undefined });
  assert.deepEqual((await gone.watch(["/r/main"])).watched, ["/r/main"]);
  gone.board();
  await gone.settled();
  assert.match(gone.board().errors[0]?.error ?? "", /信頼しているフォルダーの repo ではない/);
  const none = await gone.watch([]);
  assert.deepEqual([none.watched, none.plugins], [[], {}]);
  await fs.rm(dir, { recursive: true, force: true });
});

test("a board plugin's fetch runs in every other reading with gh, its value comes with the board, and it waits while few GraphQL points are left", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-"));
  let now = 1_000_000;
  const server = fakeServer();
  let fails = false;
  const fetchers: BoardFetchers = new Map([
    [
      "ci",
      async (repo: FetchRepo, { github }: FetchContext) => {
        if (fails) throw new Error("boom");
        await github.read(["pr", "checks", "6", "--repo", repo.repo]);
        return { prs: repo.prs.map((p) => p.number) };
      },
    ],
  ]);
  const reader = new Reader({ exec: server.exec, github: server.github, fetchers, folders: () => ["/r/wt"], file: path.join(dir, "watched.json"), log: () => undefined, now: () => now });
  const fetches = () => server.calls.filter((c) => c.startsWith("gh pr checks")).length;
  const reading = async (ms: number) => {
    now += ms;
    reader.board();
    await reader.settled();
    return reader.board();
  };

  await reader.watch(["/r/main"]);
  await reader.settled();
  // Choosing a plugin with a fetch reads at once, for what its state gets.
  now += 1000;
  await reader.watch(["/r/main"], { "/r/main": "ci" });
  await reader.settled();
  assert.deepEqual(reader.board().repos[0]?.fetched, { prs: [6] });
  assert.equal(fetches(), 1);
  // The next reading leaves it out; the one after runs it.
  await reading(60_000);
  assert.equal(fetches(), 1);
  await reading(FETCH_EVERY_MS - 60_000);
  assert.equal(fetches(), 2);

  // "今すぐ見直す" runs it however recent, and has gh read again rather than answer from what gasho-daemon kept.
  now += 15_000;
  const since = server.calls.length;
  reader.refresh();
  await reader.settled();
  assert.equal(fetches(), 3);
  const ghOfRefresh = [...server.ages].filter(([i]) => i >= since && !server.calls[i]?.startsWith("gh api rate_limit"));
  assert.deepEqual(new Set(ghOfRefresh.map(([, age]) => age)), new Set([0]));

  // A fetch that fails keeps what it gave before, and says so.
  fails = true;
  const failed = await reading(FETCH_EVERY_MS);
  assert.deepEqual(failed.repos[0]?.fetched, { prs: [6] });
  assert.deepEqual(failed.errors.map((e) => e.error), ["カンバン用のプラグイン（ci）の fetch が失敗しました：boom"]);
  fails = false;

  // While fewer than 1000 GraphQL points are left, fetch waits until the hour's points come back.
  server.points(999);
  const paused = await reading(FETCH_EVERY_MS);
  assert.equal(fetches(), 3);
  assert.equal(paused.fetchPausedUntil, RESET * 1000);
  server.points(5000);
  await reading(FETCH_EVERY_MS);
  assert.equal(fetches(), 3);
  now = RESET * 1000;
  const back = await reading(0);
  assert.equal(fetches(), 4);
  assert.equal(back.fetchPausedUntil, undefined);
  assert.deepEqual(back.errors, []);

  // Another plugin, without a fetch, reads nothing again, and its state does not get what "ci" gave.
  const calls = server.calls.length;
  const plain = await reader.watch(["/r/main"], { "/r/main": "plain" });
  assert.equal(plain.repos[0]?.fetched, undefined);
  assert.equal(server.calls.length, calls);
  await fs.rm(dir, { recursive: true, force: true });
});
