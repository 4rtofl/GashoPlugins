// The daemon part as gasho-daemon runs it (test/daemon.ts): started with a folder of its own, called with { op, ... },
// and gh answered by the test. It keeps the worktrees, the numbers GitHub did not have and the items' versions in the
// process, so each test starts it again with a folder of its own and asks about a repository of its own.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { CallError, execError, fakeContext, loadDaemon, type Ran, type Run } from "../../test/daemon.ts";
import type { WorktreeItems } from "../src/types.ts";

const daemon = await loadDaemon("github-implement");

const node = (kind: "issues" | "pulls", number: number, state = "OPEN") => ({
  __typename: kind === "pulls" ? "PullRequest" : "Issue",
  number,
  title: `#${number}`,
  state,
  url: `https://github.com/o/r/${kind === "pulls" ? "pull" : "issues"}/${number}`,
  updatedAt: "2026-11-18T00:00:00Z",
});

/** gh's answer to the query of a worktree's items: the branch's pull requests, and every number it may ask for. */
const itemsAnswer = (pulls: object[], numbers: Record<number, object | null>) =>
  JSON.stringify({ data: { repository: { pulls: { nodes: pulls }, ...Object.fromEntries(Object.entries(numbers).map(([n, v]) => [`n${n}`, v])) } } });

const isItemsQuery = (r: Ran) => r.args[1] === "graphql" && /repository\(owner: \$owner, name: \$name\) \{ (pulls: |n\d+: |__typename \})/.test(r.args[3] ?? "");
/** The numbers a query of a worktree's items asked for. */
const asked = (r: Ran) => [...(r.args[3] ?? "").matchAll(/n(\d+): issueOrPullRequest/g)].map((m) => Number(m[1]));
/** `issue view 5` / `pr view 7` */
const viewOf = (r: Ran) => (r.args[1] === "view" ? `${r.args[0]} ${r.args[2]}` : undefined);

/** The daemon part started in a folder of its own, as on a working server; `stop` ends it. */
async function started(run: Run, o: { settings?: Record<string, unknown>; dataDir?: string } = {}) {
  const dataDir = o.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "github-implement-"));
  const fake = fakeContext({ run, dataDir, ...(o.settings ? { settings: o.settings } : {}) });
  await daemon.start(fake.ctx);
  return { ...fake, dataDir, stop: () => daemon.stop() };
}

async function until(done: () => boolean, what: string): Promise<void> {
  // A round every 50 ms takes far less than this, also on a busy machine (1.3 s at a load average of 200).
  for (const end = Date.now() + 10_000; !done(); ) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("in the background, a worktree Gasho showed has its items read again, and in full only its branch's issue and open pull requests", async () => {
  const answer = itemsAnswer([node("pulls", 7), node("pulls", 8, "MERGED")], { 5: node("issues", 5), 9: node("issues", 9) });
  const d = await started(
    (r) => {
      if (isItemsQuery(r)) return answer;
      const view = viewOf(r);
      if (view) return JSON.stringify(node(r.args[0] === "pr" ? "pulls" : "issues", Number(r.args[2])));
      return execError({ stderr: "unexpected" });
    },
    { settings: { refreshSeconds: 0.05 } },
  );
  try {
    await daemon.call("write", { op: "add", repo: "o/bg", worktree: "/w/bg", number: 9 }, d.ctx);
    await daemon.call("read", { op: "items", repo: "o/bg", worktree: "/w/bg", branch: "feat/5-x" }, d.ctx);
    const views = () => new Set(d.calls.flatMap((r) => viewOf(r) ?? []));
    await until(() => views().has("issue 5") && views().has("pr 7"), "the background reads");
    // Not the merged pull request, nor the issue added by hand: their tabs read them when they open.
    assert.deepEqual([...views()].sort(), ["issue 5", "pr 7"]);
    assert.ok(d.calls.filter(isItemsQuery).length >= 3);
  } finally {
    await d.stop();
    // A round under way when it stopped would start the next one once the next test starts the daemon part again.
    await new Promise((r) => setTimeout(r, 200));
  }
});

test("numbers added by hand are kept with the worktree, also after the working server starts again, and asked for until taken off", async () => {
  const answer = itemsAnswer([], { 9: node("issues", 9), 99: null, 3: node("issues", 3) });
  const run: Run = (r) => (isItemsQuery(r) ? answer : execError({ stderr: "unexpected" }));
  const items = async (ctx: ReturnType<typeof fakeContext>["ctx"], worktree = "/w/a") =>
    (await daemon.call("read", { op: "items", repo: "o/kept", worktree, branch: "main", fresh: true }, ctx)) as WorktreeItems;

  const first = await started(run);
  try {
    await daemon.call("write", { op: "add", repo: "o/kept", worktree: "/w/a", number: 9 }, first.ctx);
    await daemon.call("write", { op: "add", repo: "o/kept", worktree: "/w/a", number: 9 }, first.ctx);
    // A number GitHub does not have is refused and not kept.
    await assert.rejects(daemon.call("write", { op: "add", repo: "o/kept", worktree: "/w/a", number: 99 }, first.ctx), { message: "o/kept に #99 はありません。" });
    assert.deepEqual((await items(first.ctx)).added.map((i) => i.number), [9]);
  } finally {
    await first.stop();
  }

  const again = await started(run, { dataDir: first.dataDir });
  try {
    assert.deepEqual((await items(again.ctx)).added.map((i) => i.number), [9]);
    await daemon.call("write", { op: "remove", worktree: "/w/a", number: 9 }, again.ctx);
    const before = again.calls.length;
    assert.deepEqual((await items(again.ctx)).added, []);
    assert.deepEqual(asked(again.calls.slice(before).find(isItemsQuery)!), []);
  } finally {
    await again.stop();
  }

  // What a broken or older file holds that is not a worktree, or not a number, is left out.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "github-implement-"));
  fs.writeFileSync(
    path.join(dataDir, "worktrees.json"),
    JSON.stringify({ worktrees: { "/w/b": { repo: "o/kept", added: [3, "9", 4.5], seenAt: 1 }, "/w/c": { added: [9] }, "/w/d": null } }),
  );
  const broken = await started(run, { dataDir });
  try {
    assert.deepEqual((await items(broken.ctx, "/w/b")).added.map((i) => i.number), [3]);
    assert.deepEqual((await items(broken.ctx, "/w/c")).added, []);
  } finally {
    await broken.stop();
  }
});

test("a worktree tab counts what came after what the item's screen showed, and an item met the first time has nothing new", async () => {
  let pull = { ...node("pulls", 7), comments: [{ createdAt: "2026-11-18T01:00:00Z", body: "a" }], reviews: [] as object[], statusCheckRollup: [] as object[] };
  const run: Run = (r) => {
    if (viewOf(r) === "pr 7") return JSON.stringify(pull);
    if (viewOf(r) === "pr 8") return execError({ stderr: "GraphQL: Could not resolve to a PullRequest with the number of 8." });
    return execError({ stderr: "unexpected" });
  };
  const d = await started(run);
  const news = (ctx = d.ctx) => daemon.call("read", { op: "news", repo: "o/news", items: [{ kind: "pulls", number: 7 }, { kind: "pulls", number: 8 }], fresh: true }, ctx);
  try {
    assert.deepEqual(await news(), {});
    pull = {
      ...pull,
      comments: [...pull.comments, { createdAt: "2026-11-18T02:00:00Z", body: "b" }],
      reviews: [{ submittedAt: "2026-11-18T03:00:00Z", state: "APPROVED", body: "" }],
      statusCheckRollup: [{ __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS", completedAt: "2026-11-18T04:00:00Z" }],
    };
    // #8 could not be read: its tab has no number, and #7's still comes.
    assert.deepEqual(await news(), { 7: { comments: 1, reviews: 1, checks: 1 } });
    // The item's screen tells what it showed; a mark older than one told before moves nothing back.
    await daemon.call("read", { op: "seen", repo: "o/news", number: 7, marks: { comment: "2026-11-18T02:00:00Z", review: "2026-11-18T03:00:00Z" } }, d.ctx);
    await daemon.call("read", { op: "seen", repo: "o/news", number: 7, marks: { comment: "2026-11-18T01:00:00Z" } }, d.ctx);
    assert.deepEqual(await news(), { 7: { comments: 0, reviews: 0, checks: 1 } });
    await assert.rejects(daemon.call("read", { op: "seen", repo: "o/news", number: 7, marks: { comment: "soon" } }, d.ctx), { message: "見た印の指定が正しくありません。" });

    // With the background reads off, the tabs have no numbers, and gh is not asked.
    const off = fakeContext({ run, dataDir: d.dataDir, settings: { refreshSeconds: 0 } });
    assert.deepEqual(await news(off.ctx), {});
    assert.deepEqual(off.calls, []);
  } finally {
    await d.stop();
  }
});

test("the marks kept in seen.json are where the counting starts; one that is not a mark counts as met the first time", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "github-implement-"));
  fs.writeFileSync(
    path.join(dataDir, "seen.json"),
    JSON.stringify({ items: { "o/file#7": { marks: { comment: "2026-11-18T01:30:00Z" }, at: 1 }, "o/file#8": { marks: "x", at: 1 } } }),
  );
  const comments = [{ createdAt: "2026-11-18T01:00:00Z", body: "a" }, { createdAt: "2026-11-18T02:00:00Z", body: "b" }];
  const d = await started((r) => (r.args[1] === "view" ? JSON.stringify({ ...node("pulls", Number(r.args[2])), comments }) : execError({ stderr: "unexpected" })), { dataDir });
  try {
    const items = [{ kind: "pulls", number: 7 }, { kind: "pulls", number: 8 }];
    assert.deepEqual(await daemon.call("read", { op: "news", repo: "o/file", items }, d.ctx), { 7: { comments: 1, reviews: 0, checks: 0 } });
  } finally {
    await d.stop();
  }
});

/** The gh commands a call ran that change GitHub. */
const writes = (calls: Ran[]) => calls.filter((c) => c.via === "github.write").map((c) => c.args);
/** The value of `-f name=…` / `-F name=…` of a gh api graphql command. */
const field = (args: string[] | undefined, name: string) => args?.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
/** A rejection with a message the person sees (a PluginError), which matches `reason`. */
const shown = (reason: RegExp) => (e: unknown) => e instanceof CallError && e.user && reason.test(e.message);

test("what the screen sends that gh must not get is refused with the reason, before gh runs", async () => {
  const refused: [string, Record<string, unknown>, RegExp][] = [
    ["merge", { repo: "o/r", number: 3, action: "merge", method: "squash", head: "a1b2c3" }, /head のコミット/],
    ["merge", { repo: "o/r", number: 3, action: "merge", method: "squash", deleteBranch: "yes" }, /ブランチを消すか/],
    ["merge", { repo: "o/r", number: 3, action: "merge", method: "fast-forward" }, /マージの方法/],
    ["merge", { repo: "o/r", number: 3, action: "close" }, /マージの操作/],
    ["lock", { repo: "o/r", kind: "issues", number: 3, lock: true, reason: "boring" }, /ロックの理由/],
    ["lock", { repo: "o/r", kind: "issues", number: 3, lock: "yes" }, /ロックするか/],
    ["transfer", { repo: "o/r", number: 3, to: "O/R" }, /いまのリポジトリと同じ/],
    ["transfer", { repo: "o/r", number: 3, to: "other/r" }, /同じ owner/],
    ["sub-issue", { repo: "o/r", action: "add", parent: 3, child: 3, childRepo: "O/R" }, /自分を自分の sub-issue/],
    ["sub-issue", { repo: "o/r", action: "move", parent: 3, child: 4 }, /足すか外すか/],
    ["revert", { repo: "o/r", number: 3, draft: "yes" }, /Draft にするか/],
    ["link-issue", { repo: "o/r", number: 3, issue: 4, linked: "yes" }, /足すか外すか/],
    ["project", { repo: "o/r", projectId: "PVT_1", action: "move" }, /Project の操作/],
    ["project", { repo: "o/r", projectId: "PVT_1", action: "set", itemId: "PVTI_1", fieldId: "F_1", value: { text: "a", number: 1 } }, /項目の値/],
    ["project", { repo: "o/r", projectId: "PVT 1", action: "remove", contentId: "I_1" }, /^Projectの指定/],
    ["rerun", { repo: "o/r", run: "123" }, /GitHub Actions の実行/],
    ["create-issue", { repo: "o/r", title: "  ", body: "" }, /題が空/],
  ];
  for (const [op, params, reason] of refused) {
    const { ctx, calls } = fakeContext();
    await assert.rejects(daemon.call("write", { op, ...params }, ctx), shown(reason), `${op} ${JSON.stringify(params)}`);
    assert.deepEqual(calls, [], op);
  }
});

test("a push to the head branch after the screen read it is told apart from other failures of a merge", async () => {
  const merge = (stderr: string) => {
    const { ctx } = fakeContext({ run: () => execError({ stderr }) });
    return daemon.call("write", { op: "merge", repo: "o/r", number: 3, action: "merge", method: "squash", head: "a".repeat(40) }, ctx);
  };
  await assert.rejects(merge("GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)\n"), shown(/head のブランチに push がありました/));
  await assert.rejects(merge("GraphQL: Pull Request is not mergeable (mergePullRequest)\n"), shown(/^GitHub での処理に失敗しました：GraphQL: Pull Request is not mergeable/));
});

test("failed jobs run again by the id of their run, past 10^9, and the call waits until GitHub shows them queued", async () => {
  const run = 19_000_000_001;
  const answers = (jobs: () => string | Error): Run => (r) => (r.via === "github.write" ? "" : jobs());
  const queued = fakeContext({ run: answers(() => JSON.stringify({ jobs: [{ status: "completed" }, { status: "queued" }] })) });
  assert.deepEqual(await daemon.call("write", { op: "rerun", repo: "o/r", run }, queued.ctx), { ok: true });
  assert.deepEqual(writes(queued.calls), [["run", "rerun", String(run), "--failed", "--repo", "o/r"]]);
  // One read of the jobs: the first that shows one queued ends the wait.
  assert.deepEqual(queued.calls.slice(1).map((c) => c.options), [{ maxAgeSeconds: 0 }]);

  // The jobs run again whether or not they could be seen start.
  const unseen = fakeContext({ run: answers(() => execError({ stderr: "HTTP 502" })) });
  assert.deepEqual(await daemon.call("write", { op: "rerun", repo: "o/r", run }, unseen.ctx), { ok: true });

  const busy = fakeContext({ run: () => execError({ stderr: "run 19000000001 cannot be rerun; its workflow run is already running\n" }) });
  await assert.rejects(daemon.call("write", { op: "rerun", repo: "o/r", run }, busy.ctx), shown(/ほかのジョブが、まだ動いています/));
});

test("a revert opens the pull request GitHub makes, as a draft when asked, and says when it cannot tell that it did", async () => {
  const revert = (answer: object, id: string | null = "PR_1") => {
    const f = fakeContext({ run: (r) => (r.via === "github.write" ? JSON.stringify(answer) : JSON.stringify(id ? { id } : {})) });
    return { ...f, call: (draft?: boolean) => daemon.call("write", { op: "revert", repo: "o/r", number: 3, ...(draft === undefined ? {} : { draft }) }, f.ctx) };
  };
  const made = { data: { revertPullRequest: { revertPullRequest: { number: 4, url: "https://github.com/o/r/pull/4" } } } };
  const ok = revert(made);
  assert.deepEqual(await ok.call(true), { number: 4, url: "https://github.com/o/r/pull/4" });
  // A node ID never changes: the read may be what gasho-daemon kept.
  assert.deepEqual(ok.calls[0]?.options, { maxAgeSeconds: 600 });
  assert.equal(field(writes(ok.calls)[0], "id"), "PR_1");
  assert.equal(field(writes(ok.calls)[0], "draft"), "true");
  await ok.call();
  assert.equal(field(writes(ok.calls)[1], "draft"), "false");

  await assert.rejects(revert({ data: { revertPullRequest: { revertPullRequest: { number: 4, url: "javascript:x" } } } }).call(), shown(/作れたか分かりません/));
  const missing = revert(made, null);
  await assert.rejects(missing.call(), shown(/o\/r に Pull request #3 はありません/));
  assert.deepEqual(writes(missing.calls), []);
});

test("an issue is linked to a pull request, or the link taken off, by the node IDs of both", async () => {
  const link = (linked: boolean, ids: object) => {
    const f = fakeContext({ run: (r) => (r.via === "github.write" ? "{}" : JSON.stringify({ data: { repository: ids } })) });
    return { ...f, done: daemon.call("write", { op: "link-issue", repo: "o/r", number: 3, issue: 4, linked }, f.ctx) };
  };
  const both = { pullRequest: { id: "PR_3" }, issue: { id: "I_4" } };
  for (const [linked, mutation] of [[true, "addCloseIssueReferences"], [false, "removeCloseIssueReferences"]] as const) {
    const l = link(linked, both);
    await l.done;
    const [args] = writes(l.calls);
    assert.match(field(args, "query") ?? "", new RegExp(mutation));
    assert.deepEqual([field(args, "issue"), field(args, "pull")], ["I_4", "PR_3"]);
  }
  const gone = link(true, { pullRequest: { id: "PR_3" }, issue: null });
  await assert.rejects(gone.done, shown(/#4 の Issue が見つかりません/));
  assert.deepEqual(writes(gone.calls), []);
});

test("a reason goes to gh only when locking, as gh takes none to unlock", async () => {
  const { ctx, calls } = fakeContext({ run: () => "" });
  await daemon.call("write", { op: "lock", repo: "o/r", kind: "issues", number: 3, lock: true, reason: "resolved" }, ctx);
  await daemon.call("write", { op: "lock", repo: "o/r", kind: "pulls", number: 3, lock: false, reason: "resolved" }, ctx);
  assert.deepEqual(writes(calls), [
    ["issue", "lock", "3", "--repo", "o/r", "--reason=resolved"],
    ["pr", "unlock", "3", "--repo", "o/r"],
  ]);
});

test("the labels and the people who can be assigned come also when gh cannot say who it is logged in as", async () => {
  const { ctx } = fakeContext({
    run: ({ args }) => {
      if (args[0] === "label") return JSON.stringify([{ name: "bug", color: "d73a4a" }, { name: "x", color: "red" }, { color: "000000" }]);
      if (args[1] === "user") return execError({ stderr: "HTTP 403" });
      return JSON.stringify([{ login: "octocat" }, { id: 1 }]);
    },
  });
  assert.deepEqual(await daemon.call("read", { op: "meta", repo: "o/r" }, ctx), { labels: [{ name: "bug", color: "d73a4a" }, { name: "x" }], assignable: ["octocat"] });
});

test("an issue moved to another repository says its new number there, taken from what gh prints", async () => {
  const transfer = async (stdout: string) => daemon.call("write", { op: "transfer", repo: "o/r", number: 3, to: "o/r.js" }, fakeContext({ run: () => stdout }).ctx);
  assert.deepEqual(await transfer("https://github.com/o/r.js/issues/12\n"), { url: "https://github.com/o/r.js/issues/12", number: 12 });
  // Not another repository's address ("." is not any character), nor nothing.
  assert.deepEqual(await transfer("https://github.com/o/rxjs/issues/12\n"), {});
  assert.deepEqual(await transfer(""), {});
});

test("a project's item is found by the project for taking it out, and gets back its values right after it is put in", async () => {
  const project = (answer: (r: Ran) => string | Error) => {
    const f = fakeContext({ run: answer });
    return { ...f, call: (p: Record<string, unknown>) => daemon.call("write", { op: "project", repo: "o/r", projectId: "PVT_1", ...p }, f.ctx) };
  };
  const added = project((r) => (field(r.args, "query")?.includes("addProjectV2ItemById") ? JSON.stringify({ data: { addProjectV2ItemById: { item: { id: "PVTI_9" } } } }) : "{}"));
  await added.call({ action: "add", contentId: "I_1", values: [{ fieldId: "F_1", value: { text: "memo" } }] });
  const [add, set] = writes(added.calls);
  assert.deepEqual([field(add, "project"), field(add, "content")], ["PVT_1", "I_1"]);
  assert.deepEqual([field(set, "item"), field(set, "f0"), field(set, "v0")], ["PVTI_9", "F_1", "memo"]);
  await assert.rejects(
    project(() => "{}").call({ action: "add", contentId: "I_1", values: [{ fieldId: "F_1", value: { text: "memo" } }] }),
    shown(/項目の値を戻せませんでした/),
  );

  const items = JSON.stringify({ data: { node: { projectItems: { nodes: [{ id: "PVTI_other", project: { id: "PVT_2" } }, { id: "PVTI_1", project: { id: "PVT_1" } }] } } } });
  const removed = project((r) => (r.via === "github.write" ? "{}" : items));
  await removed.call({ action: "remove", contentId: "I_1" });
  assert.equal(removed.calls[0]?.options && (removed.calls[0].options as { maxAgeSeconds?: number }).maxAgeSeconds, 0);
  assert.deepEqual([field(writes(removed.calls)[0], "project"), field(writes(removed.calls)[0], "item")], ["PVT_1", "PVTI_1"]);
  const elsewhere = project((r) => (r.via === "github.write" ? "{}" : items.replace('"PVT_1"', '"PVT_3"')));
  await assert.rejects(elsewhere.call({ action: "remove", contentId: "I_1" }), shown(/この Project には入っていません/));
  assert.deepEqual(writes(elsewhere.calls), []);

  const scope = "gh: Your token has not been granted the required scopes to execute this query. The 'addProjectV2ItemById' field requires one of the following scopes: ['project']";
  await assert.rejects(project(() => execError({ stderr: scope })).call({ action: "add", contentId: "I_1" }), shown(/gh auth refresh -s project/));
});

test("a sub-issue in another repository is read there, and added or taken off by the IDs of both", async () => {
  const ids = JSON.stringify({ data: { parent: { issueOrPullRequest: { __typename: "Issue", id: "I_3" } }, child: { issueOrPullRequest: { __typename: "Issue", id: "I_4" } } } });
  const { ctx, calls } = fakeContext({ run: (r) => (r.via === "github.write" ? "{}" : ids) });
  for (const action of ["add", "remove"]) await daemon.call("write", { op: "sub-issue", repo: "o/r", action, parent: 3, child: 4, childRepo: "o/other" }, ctx);
  const read = calls.find((c) => c.via === "github.read")?.args;
  assert.deepEqual(["po", "pn", "pi", "co", "cn", "ci"].map((k) => field(read, k)), ["o", "r", "3", "o", "other", "4"]);
  assert.deepEqual(
    writes(calls).map((a) => [/(add|remove)SubIssue/.exec(field(a, "query") ?? "")?.[0], field(a, "parent"), field(a, "child")]),
    [
      ["addSubIssue", "I_3", "I_4"],
      ["removeSubIssue", "I_3", "I_4"],
    ],
  );
});

test("a new issue made from a worktree's screen is added to the worktree; without its address from gh, nothing is", async () => {
  let created = "https://github.com/o/new/issues/21\n";
  const answer = itemsAnswer([], { 21: node("issues", 21), 22: node("issues", 22) });
  const d = await started((r) => (r.via === "github.write" ? created : isItemsQuery(r) ? answer : execError({ stderr: "unexpected" })));
  const items = async () => ((await daemon.call("read", { op: "items", repo: "o/new", worktree: "/w/new", fresh: true }, d.ctx)) as WorktreeItems).added.map((i) => i.number);
  try {
    assert.deepEqual(await daemon.call("write", { op: "create-issue", repo: "o/new", title: "t", body: "", worktree: "/w/new" }, d.ctx), { number: 21, url: "https://github.com/o/new/issues/21" });
    assert.deepEqual(await items(), [21]);
    created = "Creating issue in o/new\n";
    assert.deepEqual(await daemon.call("write", { op: "create-issue", repo: "o/new", title: "t", body: "", worktree: "/w/new" }, d.ctx), {});
    assert.deepEqual(await items(), [21]);
  } finally {
    await d.stop();
  }
});
