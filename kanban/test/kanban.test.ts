import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import type { MachineInfo, SessionInfo } from "@gasho/plugin-sdk";
import { arrangeCards, assignSessions, boardCards, boardHeadings, cardsOf, issueOf, kanbanCards, placeCard, type BoardPlugins, type SessionLike } from "../src/cards.ts";
import type { Fetch, FetchContext, FetchRepo, StateCard, Worktree } from "../plugins/types.ts";
import { ghError, gitCommonDir, nameArgs, parseClosed, parseGitConfig, parseGitHubUrl, parseName, parsePrs, parseReviews, parseWorktrees, readRepo, repoOptions, reviewQuery, type Exec, type GitHubRead } from "../src/daemon/git.ts";
import { BoardFolder } from "../src/daemon/folder.ts";
import { FETCH_EVERY_MS, READ_EVERY_MS, Reader } from "../src/daemon/reader.ts";
import { linkPlugin } from "../src/board-code.ts";
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
      { branch: "feat/3-b", path: "/r/wt-b", head: "b" },
    ],
    prs: [pr({ number: 9, headRefName: "feat/9-c", title: "C", isDraft: true, updatedAt: "2026-01-01T00:00:00Z" })],
    closed: [{ number: 4, headRefName: "feat/3-b", headRefOid: "b", state: "MERGED", title: "B", url: "https://github.com/o/r/pull/4" }],
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

test("cards: a fork's pull request and one merged before on the same branch are not the worktree's, and a review worktree has the pull request it is for", () => {
  const merged = { number: 4, headRefName: "feat/3-b", headRefOid: "old", state: "MERGED", title: "B", url: "https://github.com/o/r/pull/4" };
  const m: RepoMaterial = {
    repo: "o/r",
    primary: { path: "/r/main", branch: "main", head: "m" },
    worktrees: [
      { branch: "feat/3-b", path: "/r/wt-b", head: "new" },
      { branch: "feat/8-c", path: "/r/review-8", head: "c" },
    ],
    // From my fork's main: not the primary checkout's.
    prs: [pr({ number: 9, headRefName: "main", isCrossRepository: true })],
    closed: [merged],
    reviews: [{ path: "/r/review-8", number: 8, title: "Someone's", url: "https://github.com/o/r/pull/8", state: "open", isDraft: true }],
  };
  const busy = new Map([["/r/main", [session("busy", "/r/main")]]]);
  assert.deepEqual(
    cardsOf(m, busy, NONE).map((c) => [c.label, c.title, c.pr?.number, c.pr?.state, c.pr?.draft, c.review]),
    [
      ["wt-b", "feat/3-b", undefined, undefined, undefined, undefined],
      ["review-8", "Someone's", 8, "open", true, true],
      ["main", "main", undefined, undefined, undefined, undefined],
      ["PR #9", "t", 9, "open", undefined, undefined],
    ],
  );
  // On the merged pull request's last commit, the worktree is still that pull request's.
  const at = cardsOf({ ...m, worktrees: [{ branch: "feat/3-b", path: "/r/wt-b", head: "old" }] }, new Map(), NONE);
  assert.deepEqual(at.find((c) => c.label === "wt-b")?.pr, { number: 4, url: merged.url, state: "merged" });
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
  assert.equal(kanbanCards([{ machine: { ...machine, connected: false }, board, plugins: NONE }]).length, 0);
});

test("a card goes in the column its repository's board plugin gives, with its instructions, and in the first one when the plugin fails", () => {
  const m: RepoMaterial = { repo: "o/r", primary: { path: "/r/main" }, worktrees: [{ branch: "feat/2-a", path: "/r/wt-a" }], prs: [pr({ headRefName: "feat/2-a" })], closed: [], plugin: "mine" };
  const plugins: BoardPlugins = new Map<string, { state?: unknown; error?: string }>([
    ["broken", { error: "mine/lib.ts:3：TypeScript として読めません" }],
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
  // A plugin that cannot be loaded says why; one no longer in the folder says so.
  assert.deepEqual(placed("broken"), ["mine", "列を決められませんでした（broken）", "mine/lib.ts:3：TypeScript として読めません"]);
  assert.match(placeCard({ id: "x", repo: "o/r", label: "x", title: "", sessions: [] }, "gone", plugins).reason?.error ?? "", /置き場に gone\/index.ts がありません/);

  // The marks `state` gives come on the card; marks that cannot be shown put the card in "mine".
  const card: StateCard = { id: "x", repo: "o/r", label: "x", title: "", sessions: [] };
  const marked = new Map([
    ["marks", { state: () => ({ column: "github", marks: [{ text: " dev1 デプロイ中 ", detail: " since 10:00 ", active: true }, { text: "dev2", active: "yes" }] }) }],
    ["blank", { state: () => ({ column: "github", marks: [{ text: " " }] }) }],
  ]);
  assert.deepEqual(placeCard(card, "marks", marked).marks, [{ text: "dev1 デプロイ中", detail: "since 10:00", active: true }, { text: "dev2" }]);
  assert.deepEqual(placeCard(card, "blank", marked), { column: "mine", reason: { text: "列を決められませんでした（blank）", error: "state が返した印を使えません：marks のそれぞれに、空でない text が要ります。" } });
});

test("the headings above the board come from the board plugins that have them, with what their fetch gave, or say why not", () => {
  const machine = { id: "m", name: "mac", connected: true, lastSeen: 0, sessions: [] } as unknown as MachineInfo;
  const repo = (name: string, plugin?: string, fetched?: unknown): RepoMaterial => ({ repo: `o/${name}`, primary: { path: `/r/${name}` }, worktrees: [], prs: [], closed: [], ...(plugin ? { plugin } : {}), ...(fetched ? { fetched } : {}) });
  const plugins: BoardPlugins = new Map<string, { state?: unknown; headings?: unknown }>([
    ["stacks", { headings: (r: FetchRepo, f?: { last: string }) => [{ label: " dev1 ", text: `${f?.last} of ${r.repo}`, at: 5, active: false, extra: Object.keys(r).join() }] }],
    ["throws", { headings: () => { throw new Error("boom"); } }],
    ["odd", { headings: () => [{ text: "no label" }] }],
    ["plain", {}],
  ]);
  const board = { watched: [], repos: [repo("a", "stacks", { last: "wt" }), repo("b", "throws"), repo("c", "odd"), repo("d", "plain"), repo("e")], errors: [] };
  assert.deepEqual(
    boardHeadings([{ machine, board, plugins }]).map(({ repo: r, plugin, headings, error }) => [r, plugin, headings, error]),
    [
      ["o/a", "stacks", [{ label: "dev1", text: "wt of o/a", at: 5 }], undefined],
      ["o/b", "throws", [], "headings が失敗しました：boom"],
      ["o/c", "odd", [], "headings が返した見出しを使えません：それぞれに、空でない label が要ります。"],
    ],
  );
  assert.deepEqual(boardHeadings([{ machine: { ...machine, connected: false }, board, plugins }]), []);
});

test("a column's order: cards without the value stay below in either direction", () => {
  const machine = {} as MachineInfo;
  const rows = [3, undefined, 1].map((issue, i) => ({ machine, card: { id: String(i), repo: "o/r", label: String(i), title: "", column: "mine" as const, sessions: [], ...(issue ? { issue } : {}) } }));
  assert.deepEqual(arrangeCards(rows, { key: "issue", desc: false }).map((r) => r.card.issue), [1, 3, undefined]);
  assert.deepEqual(arrangeCards(rows, { key: "issue", desc: true }).map((r) => r.card.issue), [3, 1, undefined]);
});

test("git's worktree list, GitHub remotes and gh's pull requests are read, and anything odd is left out", () => {
  const porcelain = [
    ...["worktree /r/main", "HEAD a", "branch refs/heads/main", ""],
    ...["worktree /r/wt", "HEAD b", "branch refs/heads/feat/1-x", ""],
    ...["worktree /r/d", "HEAD c", "detached", ""],
    // Its folder is gone: no card, so that nothing starts there.
    ...["worktree /r/gone", "HEAD d", "branch refs/heads/feat/2-y", "prunable gitdir file points to non-existent location", ""],
  ].join("\n");
  assert.deepEqual(parseWorktrees(porcelain), {
    primary: { path: "/r/main", branch: "main", head: "a" },
    worktrees: [
      { branch: "feat/1-x", path: "/r/wt", head: "b" },
      { path: "/r/d", head: "c", detached: true },
    ],
  });
  assert.equal(parseWorktrees("worktree /r/bare.git\nbare\n").primary?.bare, true);
  assert.equal(parseGitHubUrl("git@github.com:4rtofl/Gasho.git\n"), "4rtofl/Gasho");
  assert.equal(parseGitHubUrl("https://user:token@github.com/4rtofl/GashoPlugins"), "4rtofl/GashoPlugins");
  assert.equal(parseGitHubUrl("https://gitlab.com/a/b.git"), undefined);
  assert.deepEqual(parsePrs([pr({ isDraft: false }), { ...pr(), url: "javascript:alert(1)" }, null]), [pr()]);
  assert.deepEqual(parsePrs([{ ...pr(), isCrossRepository: true }]), [pr({ isCrossRepository: true })]);
  assert.deepEqual(
    parseClosed([
      { number: 4, headRefName: "b", state: "CLOSED", title: "old", url: "https://github.com/o/r/pull/4" },
      { number: 7, headRefName: "b", headRefOid: "h7", state: "MERGED", title: "new", url: "https://github.com/o/r/pull/7" },
      // A fork's branch b is not this repository's.
      { number: 9, headRefName: "b", headRefOid: "h9", isCrossRepository: true, state: "MERGED", title: "fork", url: "https://github.com/o/r/pull/9" },
    ]).map((p) => [p.number, p.headRefOid]),
    [[7, "h7"]],
  );
  assert.ok(nameArgs("4rtoflow/GashoPlugins").includes("o=4rtoflow") && nameArgs("4rtoflow/GashoPlugins").includes("n=GashoPlugins"));
  assert.equal(parseName(JSON.stringify({ data: { repository: { nameWithOwner: "4rtofl/GashoPlugins" } } })), "4rtofl/GashoPlugins");
  assert.equal(parseName(JSON.stringify({ data: { repository: null }, errors: [{ type: "NOT_FOUND" }] })), undefined);
  assert.match(ghError({ code: "ENOENT" }), /gh）がありません/);
  assert.match(ghError({ stderr: "To get started with GitHub CLI, please run:  gh auth login" }), /gh auth login を実行/);
});

test("the repositories that can be watched are read from the files of .git, and git runs only where they do not tell", async () => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kanban-repos-")));
  const main = path.join(dir, "main");
  await writeFiles(dir, {
    "main/.git/config": '[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:o/r.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
    "main/.git/worktrees/wt/commondir": "../..\n",
    "main/sub/x": "",
    "wt/.git": `gitdir: ${main}/.git/worktrees/wt\n`,
    // origin is not given as GitHub's: insteadOf may make it so.
    "short/.git/config": '[remote "origin"]\n\turl = gh:o/short\n',
    "local/.git/config": "[core]\n\tbare = false\n",
    "bare.git/config": "[core]\n\tbare = true\n",
    "bare-wt/.git": `gitdir: ${dir}/bare.git/worktrees/x\n`,
    "bare.git/worktrees/x/commondir": "../..\n",
    "plain/x": "",
  });
  assert.equal(await gitCommonDir(path.join(dir, "wt")), path.join(main, ".git"));
  assert.equal(await gitCommonDir(path.join(main, "sub")), path.join(main, ".git"));
  assert.equal(await gitCommonDir(path.join(dir, "plain")), null);
  assert.equal(await gitCommonDir(path.join(dir, "gone")), undefined);
  const calls: string[] = [];
  const exec: Exec = async (_, args) => {
    const [, cwd = "", ...rest] = args;
    calls.push(`${path.relative(dir, cwd) || "."} ${rest.join(" ")}`);
    if (rest[0] === "remote") return { stdout: "https://github.com/o/short.git\n", stderr: "" };
    if (rest.join(" ") === "worktree list --porcelain" && cwd.endsWith("bare-wt")) return { stdout: `worktree ${dir}/bare.git\nbare\n\nworktree ${dir}/bare-wt\nHEAD a\nbranch refs/heads/x\n`, stderr: "" };
    throw Object.assign(new Error("not a git repository"), { code: 128, stdout: "", stderr: "fatal: not a git repository" });
  };
  const folders = ["wt", "main", "main/sub", "short", "local", "bare-wt", "plain", "gone"].map((f) => path.join(dir, f));
  assert.deepEqual(await repoOptions(exec, folders), [
    { path: main, github: "o/r" },
    { path: path.join(dir, "short"), github: "o/short" },
    { path: path.join(dir, "local") },
  ]);
  assert.deepEqual(calls.sort(), ["bare-wt worktree list --porcelain", "gone rev-parse --git-common-dir", "short remote get-url origin"]);
  // A config this does not read is left to git.
  assert.equal(parseGitConfig('[includeIf "gitdir:~/w/"]\n\tpath = w.gitconfig\n'), undefined);
  assert.equal(parseGitConfig('[remote "origin"]\n\turl = "https://github.com/o/r" # quoted\n'), undefined);
  assert.equal(parseGitConfig("[Remote.origin]\n\tURL = https://github.com/o/r\n")?.get("remote.origin.url"), "https://github.com/o/r");
  await fs.rm(dir, { recursive: true, force: true });
});

test("a review worktree gets the pull request it is for from one GraphQL query, also when GitHub has not got one of them", async () => {
  assert.match(reviewQuery("o/r", [8, 12]).join(" "), /pr8: pullRequest\(number: 8\).* pr12: pullRequest\(number: 12\).* -f owner=o -f name=r$/);
  const exec: Exec = async () => ({
    stdout: ["worktree /r/main", "branch refs/heads/main", "", "worktree /r/review-8", "branch refs/heads/feat/x", "", "worktree /r/review-9", "branch refs/heads/feat/y", "", "worktree /r/other/review-10", "branch refs/heads/z", ""].join("\n"),
    stderr: "",
  });
  const queries: string[][] = [];
  const answer = { data: { repository: { pr8: { number: 8, title: "Someone's", url: "https://github.com/o/r/pull/8", state: "MERGED", isDraft: false }, pr9: null } } };
  const github: GitHubRead = async (args, o) => {
    if (args[0] === "pr") return { stdout: "[]", stderr: "" };
    queries.push([...args, o?.repo ?? ""]);
    // gh fails when GitHub says one is not there, and still prints what it got.
    throw Object.assign(new Error("Command failed"), { code: 1, stdout: JSON.stringify(answer), stderr: "GraphQL: Could not resolve to a PullRequest with the number of 9." });
  };
  const material = await readRepo(exec, github, { path: "/r/main", github: "o/r" });
  assert.equal(queries.length, 1);
  assert.match(queries[0]?.join(" ") ?? "", /pr8:.*pr9:.* o\/r$/);
  assert.deepEqual(material.reviews, [{ path: "/r/review-8", number: 8, title: "Someone's", url: "https://github.com/o/r/pull/8", state: "merged" }]);
  assert.deepEqual(parseReviews({ data: { repository: { pr8: { ...answer.data.repository.pr8, url: "javascript:x" } } } }, [{ number: 8, path: "/r/review-8" }]), []);
  // Without a review worktree, nothing more is asked of GitHub.
  const noReview: Exec = async () => ({ stdout: "worktree /r/main\nbranch refs/heads/main\n", stderr: "" });
  assert.equal((await readRepo(noReview, github, { path: "/r/main", github: "o/r" })).reviews, undefined);
  assert.equal(queries.length, 1);
});

const run = promisify(execFile);

/** ctx.exec as gasho-daemon gives it: no shell, no prompts. */
const realExec: Exec = async (command, args, o = {}) => {
  const { stdout, stderr } = await run(command, args, { timeout: o.timeoutMs ?? 30_000, maxBuffer: o.maxBuffer ?? 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...o.env } });
  return { stdout, stderr };
};

test("a worktree whose rebase stopped keeps its branch and pull request, and a detached one has a card too, with their sessions", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kanban-git-")));
  const git = (cwd: string, ...args: string[]) => run("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args]);
  const [main, wt, review] = ["main", "wt", "review-7"].map((d) => path.join(root, d)) as [string, string, string];
  await fs.mkdir(main);
  await git(main, "init", "-q", "-b", "main");
  await fs.writeFile(path.join(main, "f"), "a\n");
  await git(main, "add", "f");
  await git(main, "commit", "-qm", "a");
  await git(main, "worktree", "add", "-q", "-b", "feat/5-x", wt);
  await git(main, "worktree", "add", "-q", "--detach", review);
  await fs.writeFile(path.join(main, "f"), "b\n");
  await git(main, "commit", "-qam", "b");
  await fs.writeFile(path.join(wt, "f"), "c\n");
  await git(wt, "commit", "-qam", "c");
  // The rebase stops at the conflict, with HEAD detached.
  await assert.rejects(git(wt, "rebase", "main"));

  const github: GitHubRead = async (args) => ({ stdout: JSON.stringify(args[args.indexOf("--state") + 1] === "open" ? [pr({ number: 6, headRefName: "feat/5-x" })] : []), stderr: "" });
  const m = await readRepo(realExec, github, { path: main, github: "o/r" });
  // Each is on a commit; what else it says is what the test is about.
  const withoutHead = ({ head, ...w }: Worktree) => {
    assert.match(head ?? "", /^[0-9a-f]{40}$/);
    return w;
  };
  assert.deepEqual(withoutHead(m.primary), { path: main, branch: "main" });
  assert.deepEqual(
    [...m.worktrees].map(withoutHead).sort((a, b) => a.path.localeCompare(b.path)),
    [
      { path: review, detached: true },
      { path: wt, branch: "feat/5-x", detached: true, rebasing: true },
    ],
  );
  const byPath = assignSessions([session("waiting", wt), session("busy", path.join(review, "src"))], [m.primary.path, ...m.worktrees.map((w) => w.path)]);
  assert.deepEqual(
    cardsOf(m, byPath, NONE)
      .map((c) => [c.label, c.branch, c.pr?.number, c.detached, c.rebasing, c.sessions.map((x) => x.status)])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    [
      ["review-7", undefined, undefined, true, undefined, ["busy"]],
      ["wt", "feat/5-x", 6, true, true, ["waiting"]],
    ],
  );
  await fs.rm(root, { recursive: true, force: true });
});

/** GitHub's rate limit resets then (seconds since the epoch, as the tests' clock counts). */
const RESET = 2_000;

/**
 * A working server with one repository (o/r, or what its origin says, at /r/main, with a worktree), its git, and gh as
 * gasho-daemon runs it. `names`: by the name an origin says, the name GitHub has now (null: GitHub does not find it);
 * GitHub's search takes the names it has now only.
 */
function fakeServer({ origin = "o/r", names = {} }: { origin?: string; names?: Record<string, string | null> } = {}) {
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
    if (command === "ps") return { stdout: "", stderr: "" };
    if (command !== "git" || !cwd?.startsWith("/r/")) throw Object.assign(new Error("not a git repository"), { code: 128, stdout: "", stderr: "" });
    if (rest[0] === "rev-parse") return { stdout: "/r/main/.git\n", stderr: "" };
    if (rest[0] === "worktree") return { stdout: "worktree /r/main\nbranch refs/heads/main\n\nworktree /r/wt\nbranch refs/heads/feat/5-x\n", stderr: "" };
    return { stdout: `git@github.com:${origin}.git\n`, stderr: "" };
  };
  const github: GitHubRead = async (args, o) => {
    ages.set(calls.push(["gh", ...args].join(" ")) - 1, o?.maxAgeSeconds);
    if (args[0] === "api" && args[1] === "rate_limit") return { stdout: JSON.stringify({ resources: { graphql: { limit: 5000, remaining: pointsLeft, reset: RESET } } }), stderr: "" };
    if (ghFails) throw Object.assign(new Error("Command failed"), { code: 1, stdout: "", stderr: "error connecting to api.github.com" });
    if (args[0] === "api" && args[1] === "graphql") {
      const asked = `${args.find((a) => a.startsWith("o="))?.slice(2)}/${args.find((a) => a.startsWith("n="))?.slice(2)}`;
      const name = asked in names ? names[asked] : asked;
      if (name === null) {
        const stdout = JSON.stringify({ data: { repository: null }, errors: [{ type: "NOT_FOUND" }] });
        throw Object.assign(new Error("Command failed"), { code: 1, stdout, stderr: `gh: Could not resolve to a Repository with the name '${asked}'.` });
      }
      return { stdout: JSON.stringify({ data: { repository: { nameWithOwner: name } } }), stderr: "" };
    }
    const repo = args[args.indexOf("--repo") + 1] ?? "";
    const state = args[args.indexOf("--state") + 1];
    const found = state === "open" && (!(repo in names) || names[repo] === repo);
    return { stdout: JSON.stringify(found ? [pr({ number: 6, headRefName: "feat/5-x" })] : []), stderr: "" };
  };
  return { exec, github, calls, ages, fail: (v: boolean) => (ghFails = v), points: (n: number) => (pointsLeft = n) };
}

test("the watched repositories are kept in the plugin's folder, read at most once a minute, and keep their cards when gh fails", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-"));
  const file = path.join(dir, "watched.json");
  let now = 1_000_000;
  const server = fakeServer();
  const reader = new Reader({ exec: server.exec, github: server.github, storeDir: dir, folders: () => ["/r/wt", "/elsewhere"], file, log: () => undefined, now: () => now });
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
  const again = new Reader({ exec: server.exec, github: server.github, storeDir: dir, folders: () => ["/r/wt"], file, log: () => undefined });
  await again.load();
  assert.deepEqual(again.board().watched, ["/r/main"]);
  assert.deepEqual(again.board().plugins, { "/r/main": "mine" });
  await again.settled();
  // A repository watched before may stay while its folder is gone, so that it can be taken off.
  const gone = new Reader({ exec: server.exec, github: server.github, storeDir: dir, folders: () => [], file, log: () => undefined });
  assert.deepEqual((await gone.watch(["/r/main"])).watched, ["/r/main"]);
  gone.board();
  await gone.settled();
  assert.match(gone.board().errors[0]?.error ?? "", /信頼しているフォルダーの repo ではない/);
  const none = await gone.watch([]);
  assert.deepEqual([none.watched, none.plugins], [[], {}]);
  await fs.rm(dir, { recursive: true, force: true });
});

test("saves at the same time leave the file whole with the last one, and a broken file is dropped for none", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-"));
  const file = path.join(dir, "watched.json");
  const server = fakeServer();
  await fs.writeFile(file, '{"paths": ["/r/main"');
  const logged: unknown[] = [];
  const reader = new Reader({ exec: server.exec, github: server.github, storeDir: dir, folders: () => ["/r/wt"], file, log: (...a) => logged.push(a), now: () => 1_000_000 });
  await reader.load();
  assert.deepEqual(reader.board().watched, []);
  assert.equal(logged.length, 1);
  const names = Array.from({ length: 20 }, (_, i) => `p${i}`);
  const boards = await Promise.all(names.map((name) => reader.watch(["/r/main"], { "/r/main": name })));
  assert.deepEqual(boards.map((b) => b.plugins?.["/r/main"]), names);
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), { paths: ["/r/main"], plugins: { "/r/main": "p19" } });
  assert.deepEqual((await fs.readdir(dir)).filter((f) => f.endsWith(".tmp")), []);
  await reader.settled();
  await fs.rm(dir, { recursive: true, force: true });
});

test("a board plugin's fetch that fails says whether gh, a command or the plugin failed", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-"));
  const server = fakeServer();
  const noPs: Exec = async (command, args, o) => {
    if (command === "ps") throw Object.assign(new Error("spawn ps ENOENT"), { code: "ENOENT", stdout: "", stderr: "" });
    if (command === "lsof") throw Object.assign(new Error("Command failed: lsof"), { code: 1, stdout: "", stderr: "lsof: status error on 7: not found" });
    return server.exec(command, args, o);
  };
  const github: GitHubRead = async (args, o) => {
    if (args[0] === "pr" && args[1] === "checks") throw Object.assign(new Error("Command failed: gh"), { code: 1, stdout: "", stderr: "HTTP 404: Not Found" });
    return server.github(args, o);
  };
  const fetchers = new Map<string, Fetch>([
    ["ps", async (_, { exec }) => exec("ps", ["axww"])],
    ["lsof", async (_, { exec }) => exec("lsof", ["-p", "7"])],
    ["gh", async (repo, { github: gh }) => gh.read(["pr", "checks", "6", "--repo", repo.repo])],
  ]);
  let now = 1_000_000;
  const reader = new Reader({ exec: noPs, github, fetcher: (n) => fetchers.get(n), storeDir: dir, folders: () => ["/r/wt"], file: path.join(dir, "watched.json"), log: () => undefined, now: () => now });
  const errorOf = async (name: string) => {
    now += FETCH_EVERY_MS;
    await reader.watch(["/r/main"], { "/r/main": name });
    await reader.settled();
    return reader.board().errors.map((e) => e.error);
  };
  assert.deepEqual(await errorOf("ps"), ["カンバン用のプラグイン（ps）の fetch が失敗しました：working server に ps がありません。"]);
  assert.deepEqual(await errorOf("lsof"), ["カンバン用のプラグイン（lsof）の fetch が失敗しました：lsof が失敗しました：lsof: status error on 7: not found"]);
  assert.deepEqual(await errorOf("gh"), ["カンバン用のプラグイン（gh）の fetch が失敗しました：GitHub でこのリポジトリを読めませんでした。gh でログインしているアカウントに権限がないか、リポジトリがありません。"]);
  await fs.rm(dir, { recursive: true, force: true });
});

test("a board plugin's fetch runs in every other reading with gh, its value comes with the board, and it waits while few GraphQL points are left", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-"));
  let now = 1_000_000;
  const server = fakeServer();
  let fails = false;
  const fetchers = new Map<string, Fetch>([
    [
      "ci",
      async (repo: FetchRepo, { github }: FetchContext) => {
        if (fails) throw new Error("boom");
        await github.read(["pr", "checks", "6", "--repo", repo.repo]);
        return { prs: repo.prs.map((p) => p.number) };
      },
    ],
  ]);
  const reader = new Reader({ exec: server.exec, github: server.github, fetcher: (n) => fetchers.get(n), storeDir: dir, folders: () => ["/r/wt"], file: path.join(dir, "watched.json"), log: () => undefined, now: () => now });
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

test("a board plugin's fetch runs commands and gets what it kept the time before, after gasho-daemon starts again too, and runs only while the board is asked for or its code changed", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-"));
  let now = 1_000_000;
  const server = fakeServer();
  const fetchers = new Map<string, Fetch>([
    [
      "count",
      async (_: FetchRepo, { exec, store }: FetchContext) => {
        await exec("ps", ["axww", "-o", "pid=,command="]);
        const n = ((store.get() as number | undefined) ?? 0) + 1;
        await store.set(n);
        return n;
      },
    ],
    ["other", async (_: FetchRepo, { store }: FetchContext) => store.get() ?? "none"],
  ]);
  const start = () => new Reader({ exec: server.exec, github: server.github, fetcher: (n) => fetchers.get(n), storeDir: path.join(dir, "stores"), folders: () => ["/r/wt"], file: path.join(dir, "watched.json"), log: () => undefined, now: () => now });
  const reader = start();
  await reader.watch(["/r/main"], { "/r/main": "count" });
  await reader.settled();
  assert.equal(reader.board().repos[0]?.fetched, 1);
  assert.ok(server.calls.includes("ps axww -o pid=,command="));

  // While no browser asks for the board, nothing runs, however long.
  const calls = server.calls.length;
  now += 10 * FETCH_EVERY_MS;
  // Its code changed meanwhile: it waits for the next reading too.
  reader.pluginsChanged(new Set(["count"]));
  await reader.settled();
  assert.equal(server.calls.length, calls);
  reader.board();
  await reader.settled();
  assert.equal(reader.board().repos[0]?.fetched, 2);
  // While the board shows, a plugin whose code changed (saved in its folder) runs its fetch at once, however recent;
  // one that no repository chose reads nothing.
  reader.pluginsChanged(new Set(["other"]));
  await reader.settled();
  assert.equal(reader.board().repos[0]?.fetched, 2);
  reader.pluginsChanged(new Set(["count"]));
  await reader.settled();
  assert.equal(reader.board().repos[0]?.fetched, 3);

  // gasho-daemon started again: what it kept is in the file.
  const again = start();
  await again.load();
  again.board();
  await again.settled();
  assert.equal(again.board().repos[0]?.fetched, 4);
  // Another plugin does not get it.
  await again.watch(["/r/main"], { "/r/main": "other" });
  await again.settled();
  assert.equal(again.board().repos[0]?.fetched, "none");
  await fs.rm(dir, { recursive: true, force: true });
});

/** Waits until `ok` holds, for the folder's watcher. */
async function until(ok: () => boolean, ms = 5000): Promise<void> {
  for (const end = Date.now() + ms; !ok(); ) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const TEMPLATE = path.join(import.meta.dirname, "../plugins");

async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [file, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), text);
  }
}

test("the board plugins' folder gets the kanban's files whenever it starts and the sample once, and keeps what each person wrote", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-plugins-"));
  await writeFiles(dir, { "AGENTS.md": "old guide", "mine/index.ts": "mine" });
  const folder = (guide: string) => new BoardFolder({ dir, placed: { "AGENTS.md": guide, "types.ts": "types" }, sample: { "example/index.ts": "sample", "example/stacks.ts": "stacks" }, log: () => undefined });
  await folder("guide").prepare();
  const read = (f: string) => fs.readFile(path.join(dir, f), "utf8");
  assert.deepEqual(await Promise.all(["AGENTS.md", "types.ts", "example/index.ts", "example/stacks.ts", "mine/index.ts"].map(read)), ["guide", "types", "sample", "stacks", "mine"]);
  // The kanban updated: its files are new, the sample as each person changed it.
  await fs.writeFile(path.join(dir, "example/index.ts"), "changed sample");
  await fs.rm(path.join(dir, "example/stacks.ts"));
  await folder("new guide").prepare();
  assert.deepEqual(await Promise.all(["AGENTS.md", "example/index.ts", "mine/index.ts"].map(read)), ["new guide", "changed sample", "mine"]);
  await assert.rejects(read("example/stacks.ts"));
  await fs.rm(dir, { recursive: true, force: true });
});

test("a board plugin loads with the files it imports, runs its fetch here and its state from the same code, and a broken one says which file and why", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-plugins-"));
  const template = async (f: string) => fs.readFile(path.join(TEMPLATE, f), "utf8");
  await writeFiles(dir, {
    "types.ts": await template("types.ts"),
    "example/index.ts": await template("example/index.ts"),
    "example/stacks.ts": await template("example/stacks.ts"),
    "mine/index.ts": [
      'import type { Fetch, State } from "../types.ts";',
      'import { columnOf, type Info } from "./lib.ts";',
      "export const fetch: Fetch<Info> = async (repo) => ({ open: repo.prs.length });",
      "export const state: State<Info> = (card, info) => ({ column: columnOf(info), reason: card.label });",
    ].join("\n"),
    "mine/lib.ts": 'export interface Info { open: number }\nexport const columnOf = (info: Info | undefined): "github" | "mine" => (info && info.open > 0 ? "github" : "mine");\n',
    "syntax/index.ts": 'export const state = () => ({ column: "mine" });\nconst x: = 1;\n',
    "enum/index.ts": 'export enum Column { Mine = "mine" }\nexport const state = () => ({ column: Column.Mine });\n',
    "nostate/index.ts": "export const headings = () => [];\n",
    "node/index.ts": 'import fs from "node:fs";\nexport const state = () => ({ column: fs ? "mine" : "done" });\n',
    "missing/index.ts": 'import { a } from "./a.ts";\nexport const state = () => ({ column: a });\n',
    "loop/index.ts": 'import { a } from "./a.ts";\nexport const state = () => ({ column: a });\n',
    "loop/a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
    "loop/b.ts": 'import { a } from "./a.ts";\nexport const b = "mine";\nexport const c = a;\n',
    "throws/index.ts": 'import { a } from "./lib.ts";\nexport const state = () => ({ column: a });\n',
    "throws/lib.ts": 'export const a = "mine";\nthrow new Error("boom");\n',
    "notes/readme.md": "not a plugin",
  });
  const folder = new BoardFolder({ dir, placed: {}, sample: {}, log: () => undefined });
  const set = await folder.reload();
  assert.deepEqual(set.names, ["enum", "example", "loop", "mine", "missing", "node", "nostate", "syntax", "throws"]);
  assert.deepEqual(set.plugins.map((p) => [p.name, Object.keys(p.modules).sort()]), [
    ["example", ["example/index.ts", "example/stacks.ts"]],
    ["mine", ["mine/index.ts", "mine/lib.ts"]],
  ]);
  const problems = new Map(set.problems.map((p) => [p.plugin, `${p.file}:${p.line ?? ""} ${p.error}`]));
  assert.match(problems.get("syntax") ?? "", /^syntax\/index.ts:2 TypeScript として読めません：/);
  assert.match(problems.get("enum") ?? "", /^enum\/index.ts:1 型を取り除くだけでは動かない書き方です/);
  assert.equal(problems.get("nostate"), "nostate/index.ts: state を export していません。カードの列を決める state(card, fetched) が要ります。");
  assert.equal(problems.get("node"), "node/index.ts:1 node:fs は import できません。import できるのは、この置き場の .ts のファイルだけです。");
  assert.equal(problems.get("missing"), "missing/index.ts:1 ./a.ts がありません。");
  assert.equal(problems.get("loop"), "loop/index.ts: import が輪になっています：loop/index.ts → loop/a.ts → loop/b.ts → loop/a.ts");
  assert.match(problems.get("throws") ?? "", /^throws\/lib.ts:2 読み込めません：boom$/);

  // `fetch` runs in the daemon part, from the folder.
  const repo: FetchRepo = { repo: "o/r", primary: { path: "/r/main" }, worktrees: [], prs: [pr()], closed: [] };
  const ctx = { github: { read: async () => assert.fail("no gh") }, exec: async () => assert.fail("no commands"), store: { get: () => undefined, set: async () => undefined } } satisfies FetchContext;
  assert.deepEqual(await folder.fetcher("mine")?.(repo, ctx), { open: 1 });
  assert.equal(typeof folder.fetcher("example"), "function");
  assert.equal(folder.fetcher("syntax"), undefined);
  // The web part runs `state` from the same code, linked the same way (blob: URLs there).
  const mine = set.plugins.find((p) => p.name === "mine");
  assert.ok(mine);
  const linked = linkPlugin(mine, (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  const web = (await import(linked.entry)) as { state: (card: StateCard, info: unknown) => { column: string; reason?: string } };
  assert.deepEqual(web.state({ id: "x", repo: "o/r", label: "wt", title: "", sessions: [] }, { open: 1 }), { column: "github", reason: "wt" });

  // The same files give the same version; a change gives another.
  assert.equal((await folder.reload()).version, set.version);
  await fs.writeFile(path.join(dir, "syntax/index.ts"), 'export const state = () => ({ column: "mine" });\n');
  const fixed = await folder.reload();
  assert.notEqual(fixed.version, set.version);
  assert.ok(fixed.plugins.some((p) => p.name === "syntax"));
  await fs.rm(dir, { recursive: true, force: true });
});

test("saving a file of the board plugins' folder reads them again, and says which plugins changed", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-plugins-"));
  await writeFiles(dir, {
    "a/index.ts": 'import { column } from "./lib.ts";\nexport const state = () => ({ column });\n',
    "a/lib.ts": 'export const column = "mine";\n',
    "b/index.ts": 'export const state = () => ({ column: "done" });\n',
  });
  const folder = new BoardFolder({ dir, placed: {}, sample: {}, log: () => undefined });
  const changes: string[][] = [];
  const first = await folder.start((_, changed) => changes.push([...changed].sort()));
  assert.deepEqual(first.plugins.map((p) => p.name), ["a", "b"]);
  await fs.writeFile(path.join(dir, "a/lib.ts"), 'export const column = "agent";\n');
  await until(() => changes.length > 0);
  assert.deepEqual(changes, [["a"]]);
  // The cards written out are not read.
  await writeFiles(dir, { "cards/o__r.json": "{}" });
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(changes.length, 1);
  folder.stop();
  await fs.rm(dir, { recursive: true, force: true });
});

test("a clone whose origin says its owner's old name shows my pull requests by the name GitHub has now, read again once an hour", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-"));
  let now = 1_000_000;
  const start = (names: Record<string, string | null>, origin: string) => {
    const server = fakeServer({ origin, names });
    const seen: Fetch = async (repo) => repo.repo;
    const file = path.join(dir, `${origin.replace("/", "-")}.json`);
    const reader = new Reader({ exec: server.exec, github: server.github, fetcher: (n) => (n === "seen" ? seen : undefined), storeDir: dir, folders: () => ["/r/wt"], file, log: () => undefined, now: () => now });
    const reading = async (ms: number) => {
      now += ms;
      reader.board();
      await reader.settled();
      return reader.board();
    };
    const asked = () => server.calls.filter((c) => c.startsWith("gh api graphql")).length;
    return { reader, reading, asked };
  };

  const old = start({ "old/r": "new/r" }, "old/r");
  await old.reader.watch(["/r/main"], { "/r/main": "seen" });
  await old.reader.settled();
  const board = old.reader.board();
  // The cards, and what the board plugin's fetch gets, have the name GitHub has now.
  assert.deepEqual([board.repos[0]?.repo, board.repos[0]?.prs.map((p) => p.number), board.repos[0]?.fetched, board.errors], ["new/r", [6], "new/r", []]);
  assert.equal(old.asked(), 1);
  await old.reading(READ_EVERY_MS);
  assert.equal(old.asked(), 1);
  await old.reading(60 * 60_000);
  assert.equal(old.asked(), 2);

  // One GitHub does not find keeps its origin's name, and is not asked about again within the hour.
  const gone = start({ "gone/r": null }, "gone/r");
  await gone.reader.watch(["/r/main"]);
  await gone.reader.settled();
  assert.equal(gone.reader.board().repos[0]?.repo, "gone/r");
  await gone.reading(READ_EVERY_MS);
  assert.equal(gone.asked(), 1);
  await fs.rm(dir, { recursive: true, force: true });
});
