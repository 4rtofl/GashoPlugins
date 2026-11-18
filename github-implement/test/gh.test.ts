import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import comments from "../src/daemon/detail/comments.ts";
import commits from "../src/daemon/detail/commits.ts";
import type { DaemonContext, GitHubReadOptions } from "@gasho/plugin-sdk/daemon";
import { askFresh, begin, end, itemRead, readAgain, readDetail, readItems, type Ctx } from "../src/daemon/core.ts";
import itemsOp from "../src/daemon/ops/items.ts";
import { branchArg, detailArgs, fitDetail, ghError, itemsQueryArgs, itemVersions, parseDetail, parseItems, repoArg } from "../src/daemon/gh.ts";
import { worktreeHeads } from "../src/daemon/head.ts";
import { parseLocked } from "../src/daemon/ops/locked.ts";
import type { GitHubItemDetail, WorktreeItems } from "../src/types.ts";
import { commentArgs } from "../src/daemon/ops/comment.ts";
import { editArgs } from "../src/daemon/ops/edit.ts";
import { stateArgs } from "../src/daemon/ops/state.ts";
import { branchNumber, numberFrom, typedItem } from "../src/number.ts";

test("a branch is named after the issue in its number", () => {
  assert.equal(branchNumber("feat/17-resume-outside"), 17);
  assert.equal(branchNumber("fix/16-plugin-css-override"), 16);
  assert.equal(branchNumber("main"), undefined);
  assert.equal(branchNumber("feat/plugins"), undefined);
  assert.equal(branchNumber(undefined), undefined);
});

test("one query reads the branch's pull requests and every number asked for, each once", () => {
  const args = itemsQueryArgs("4rtofl/Gasho", "feat/30-plugin-tabs", [30, 17, 30]);
  const query = args[args.indexOf("-f") + 1] ?? "";
  assert.match(query, /\$branch: String!/);
  // Inside PullRequest nodes, a fragment on Issue is an error of the whole query.
  const pulls = /pullRequests\(headRefName: \$branch.*? n30:/.exec(query)?.[0] ?? "";
  assert.match(pulls, /\{ nodes \{ __typename number title state isDraft url updatedAt /);
  assert.doesNotMatch(pulls, /on Issue/);
  assert.equal(query.match(/n30: issueOrPullRequest/g)?.length, 1);
  assert.match(query, /n17: issueOrPullRequest\(number: 17\)/);
  assert.ok(args.includes("branch=feat/30-plugin-tabs") && args.includes("owner=4rtofl") && args.includes("name=Gasho"));

  // Without a branch, the query has no $branch (GitHub refuses a variable it does not use) and still asks for a field.
  const bare = itemsQueryArgs("4rtofl/Gasho", undefined, []);
  const q = bare[bare.indexOf("-f") + 1] ?? "";
  assert.doesNotMatch(q, /\$branch/);
  assert.match(q, /repository\(owner: \$owner, name: \$name\) \{ __typename \}/);
  assert.ok(!bare.some((a) => a.startsWith("branch=")));
});

test("the answer becomes the worktree's items, and numbers GitHub does not have are told apart", () => {
  const json = JSON.stringify({
    data: {
      repository: {
        pulls: {
          nodes: [
            { __typename: "PullRequest", number: 36, title: "タブを足す", state: "OPEN", isDraft: true, url: "https://github.com/4rtofl/Gasho/pull/36" },
            { __typename: "PullRequest", number: 35, title: "elsewhere", state: "OPEN", url: "javascript:alert(1)" },
          ],
        },
        // The tab of an issue closed as not planned looks apart from one closed as done.
        n30: { __typename: "Issue", number: 30, title: "タブの仕組み", state: "CLOSED", stateReason: "NOT_PLANNED", url: "https://github.com/4rtofl/Gasho/issues/30" },
        n24: { __typename: "PullRequest", number: 24, title: "サイドバー", state: "MERGED", isDraft: false, url: "https://github.com/4rtofl/Gasho/pull/24" },
        n99: null,
      },
    },
    errors: [{ type: "NOT_FOUND", path: ["repository", "n99"] }],
  });
  assert.deepEqual(parseItems(json, 30, [24, 99], 1000), {
    named: { kind: "issues", number: 30, title: "タブの仕組み", state: "closed", stateReason: "not_planned", url: "https://github.com/4rtofl/Gasho/issues/30" },
    pulls: [{ kind: "pulls", number: 36, title: "タブを足す", state: "open", draft: true, url: "https://github.com/4rtofl/Gasho/pull/36" }],
    added: [{ kind: "pulls", number: 24, title: "サイドバー", state: "merged", url: "https://github.com/4rtofl/Gasho/pull/24" }],
    missing: [99],
    at: 1000,
  });
});

test("a fork's pull request, and one merged before from a branch of the same name, are not the worktree's", () => {
  const head = "a".repeat(40);
  const node = (number: number, o: Record<string, unknown>) => ({ __typename: "PullRequest", number, title: `#${number}`, url: `https://github.com/o/r/pull/${number}`, isCrossRepository: false, ...o });
  const json = JSON.stringify({
    data: {
      repository: {
        pulls: {
          nodes: [
            node(9, { state: "OPEN", isCrossRepository: true, headRefOid: head }),
            node(8, { state: "MERGED", isCrossRepository: true, headRefOid: head }),
            node(7, { state: "OPEN", headRefOid: "c".repeat(40) }),
            node(6, { state: "MERGED", headRefOid: "b".repeat(40) }),
            node(5, { state: "MERGED", headRefOid: head.toUpperCase() }),
            node(4, { state: "CLOSED", headRefOid: "d".repeat(40) }),
          ],
        },
      },
    },
  });
  const pulls = (h?: string) => parseItems(json, undefined, [], 0, h).pulls.map((p) => p.number);
  // An open one is the branch's whatever the worktree's HEAD; a merged one only at its head commit.
  assert.deepEqual(pulls(head), [7, 5, 4]);
  // Without the worktree's HEAD, no merged one is the worktree's.
  assert.deepEqual(pulls(), [7, 4]);
  const query = itemsQueryArgs("o/r", "feat/5-x", []).find((a) => a.startsWith("query=")) ?? "";
  assert.match(query, /isCrossRepository/);

  // The worktree's HEAD, as `git worktree list --porcelain` gives it.
  const list = ["worktree /home/u/r", `HEAD ${"e".repeat(40)}`, "branch refs/heads/main", "", "worktree /home/u/r-feat", `HEAD ${head}`, "branch refs/heads/feat/5-x", "", "worktree /home/u/r-x", `HEAD ${"f".repeat(40)}`, "detached", ""].join("\n");
  assert.equal(worktreeHeads(list).get("/home/u/r-feat"), head);
  assert.equal(worktreeHeads(list).size, 3);
});

test("a label, person or reviewer gh did not find is named; a repository it did not find is not taken for one", () => {
  const error = (stderr: string) => ghError({ stderr, message: "Command failed: gh …" });
  assert.equal(error("could not add label: 'won't fix' not found\n"), "ラベル「won't fix」が、このリポジトリで見つかりません。");
  assert.equal(error("could not assign user: 'nobody' not found\n"), "担当者「nobody」が、このリポジトリで見つかりません。");
  assert.equal(error("could not request reviewer: 'o/team' not found\n"), "レビュアー「o/team」が、このリポジトリで見つかりません。");
  // gh issue edit, gh pr edit: without what it was.
  assert.equal(error("failed to update https://github.com/o/r/issues/1: 'bug2' not found\nfailed to update 1 issue\n"), "「bug2」が、このリポジトリで見つかりません。");
  assert.equal(error("'nobody' not found\n"), "「nobody」が、このリポジトリで見つかりません。");
  assert.match(error("GraphQL: Could not resolve to a Repository with the name 'o/r'. (repository)\n"), /このリポジトリを読めませんでした/);
  assert.match(error("HTTP 404: Not Found (https://api.github.com/repos/o/r)\n"), /このリポジトリを読めませんでした/);
});

test("what the browser sends never becomes a flag of gh", () => {
  assert.throws(() => repoArg("--repo"));
  assert.throws(() => repoArg("-R/x"));
  assert.throws(() => repoArg("a/b c"));
  assert.equal(repoArg("4rtofl/Gasho"), "4rtofl/Gasho");
  assert.throws(() => branchArg("--upload-pack=x"));
  assert.throws(() => branchArg("a..b"));
  assert.equal(branchArg("feat/4-github-almighty"), "feat/4-github-almighty");
  // Text that starts with "-" stays the value of its flag.
  assert.deepEqual(commentArgs("o/r", "issues", 3, "/tmp/c.md"), ["issue", "comment", "3", "--repo", "o/r", "--body-file=/tmp/c.md"]);
  assert.deepEqual(editArgs("o/r", "pulls", 3, { title: "-t", addAssignees: ["@me"], removeLabels: ["bug"] }), ["pr", "edit", "3", "--repo", "o/r", "--title=-t", "--add-assignee=@me", "--remove-label=bug"]);
  assert.deepEqual(stateArgs("o/r", "issues", 3, "close", "not_planned"), ["issue", "close", "3", "--repo", "o/r", "--reason=not planned"]);
  assert.deepEqual(stateArgs("o/r", "pulls", 3, "close", "not_planned"), ["pr", "close", "3", "--repo", "o/r"]);
});

test("a number is taken from 17, #17, or a URL of the same repository only", () => {
  assert.equal(numberFrom(" #17 ", "4rtofl/Gasho"), 17);
  assert.equal(numberFrom("https://github.com/4rtofl/Gasho/pull/36/files", "4rtofl/Gasho"), 36);
  assert.equal(numberFrom("https://github.com/4rtofl/GashoPlugins/issues/4", "4rtofl/Gasho"), undefined);
  assert.equal(numberFrom("abc", "4rtofl/Gasho"), undefined);
  // Neither is searched: GitHub reads "-1" as "without 1", and another repository's number is not this one's.
  assert.ok(typedItem("-1", "4rtofl/Gasho") && "wrong" in typedItem("-1", "4rtofl/Gasho")!);
  assert.match((typedItem("https://github.com/4rtofl/GashoPlugins/issues/4", "4rtofl/Gasho") as { wrong: string }).wrong, /4rtofl\/GashoPlugins の URL/);
  assert.equal(typedItem("ログイン 画面", "4rtofl/Gasho"), undefined);
});

test("a body comes whole, as the edit box starts from it and saves it back", () => {
  const body = `${"a".repeat(65_000)}\nend`;
  const json = JSON.stringify({ number: 1, title: "t", url: "https://github.com/o/r/issues/1", state: "OPEN", body, comments: [{ createdAt: "2026-11-15T00:00:00Z", body: "c".repeat(70_000) }] });
  const item = parseDetail(json, "issues", [comments]);
  assert.equal(item?.body, body);
  assert.ok((item?.comments?.[0]?.body.length ?? 0) < 70_000);
});

test("the parts of detail/ add their fields only for the kinds they name", () => {
  const parts = [comments, commits];
  const fields = (kind: "issues" | "pulls") => (detailArgs("o/r", kind, 1, parts).at(-1) ?? "").split(",");
  // gh refuses `gh issue view --json commits`: a part for pull requests must stay out of an issue's read.
  assert.ok(fields("issues").includes("comments") && !fields("issues").includes("commits"));
  assert.ok(fields("pulls").includes("commits"));
  assert.equal(new Set(fields("pulls")).size, fields("pulls").length);
  const issue = parseDetail(JSON.stringify({ number: 1, title: "t", url: "https://github.com/o/r/issues/1", state: "OPEN", commits: [{ oid: "a".repeat(40) }] }), "issues", parts);
  assert.equal(issue?.commits, undefined);
});

test("an open pull request's version changes when a check ends or its base moves on; a closed one's only with updatedAt", () => {
  const checks = (running: number) => ({
    nodes: [{ commit: { statusCheckRollup: { contexts: { checkRunCountsByState: [{ state: "IN_PROGRESS", count: running }, { state: "SUCCESS", count: 2 - running }] } } } }],
  });
  const pull = (o: Record<string, unknown> = {}) => ({ __typename: "PullRequest", number: 36, state: "OPEN", updatedAt: "2026-11-15T00:00:00Z", headRefOid: "a", baseRefOid: "b", mergeable: "MERGEABLE", commits: checks(1), ...o });
  const version = (raw: Record<string, unknown>) => itemVersions(JSON.stringify({ data: { repository: { pulls: { nodes: [raw] } } } })).get(36);
  assert.notEqual(version(pull()), version(pull({ commits: checks(0) })));
  assert.notEqual(version(pull()), version(pull({ baseRefOid: "c" })));
  assert.equal(version(pull({ state: "MERGED" })), version(pull({ state: "MERGED", commits: checks(0), baseRefOid: "c" })));
  assert.notEqual(version(pull({ state: "MERGED" })), version(pull({ state: "MERGED", updatedAt: "2026-11-15T00:01:00Z" })));

  const both = itemVersions(JSON.stringify({ data: { repository: { pulls: { nodes: [pull()] }, n30: { __typename: "Issue", number: 30, state: "OPEN", updatedAt: "2026-11-15T00:02:00Z" }, n99: null } } }));
  assert.deepEqual([...both.keys()].sort(), [30, 36]);
  assert.equal(both.get(30), "2026-11-15T00:02:00Z");
});

test("the reads of an item use what gasho-daemon kept since its version was read, up to 10 minutes", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const tick = (seconds: number) => t.mock.timers.tick(seconds * 1000);
  let updatedAt = "2026-11-15T00:00:00Z";
  let whileRead: (() => Promise<void>) | undefined;
  const maxAges: (number | undefined)[] = [];
  const ctx = {
    github: {
      read: async (args: string[], o: GitHubReadOptions = {}) => {
        if (args.some((a) => a.includes("issueOrPullRequest(number: 7)"))) {
          return { stdout: JSON.stringify({ data: { repository: { n7: { __typename: "Issue", number: 7, title: "t", state: "OPEN", url: "https://github.com/o/v/issues/7", updatedAt } } } }), stderr: "" };
        }
        maxAges.push(o.maxAgeSeconds);
        await whileRead?.();
        return { stdout: "{}", stderr: "" };
      },
    },
    log: () => undefined,
  } as unknown as Ctx;
  const maxAgeOfRead = async (params: Record<string, unknown> = {}) => {
    await itemRead(ctx, "o/v", 7, params)(["api", "graphql", "-f", "query=…"]);
    return maxAges.at(-1);
  };

  // In no worktree's tabs: as old as other reads (keepSeconds with the default interval of 60 seconds).
  assert.equal(await maxAgeOfRead(), 55);
  await readItems(ctx, "o/v", "feat/7-x", [], 55);
  tick(30);
  assert.equal(await maxAgeOfRead(), 30);
  // The version is read again first when it is older than keepSeconds; still the same, the kept answers stay good.
  tick(90);
  assert.equal(await maxAgeOfRead(), 120);
  tick(900);
  assert.equal(await maxAgeOfRead(), 600);
  assert.equal(await maxAgeOfRead({ fresh: true }), 0);

  // GitHub changed it: only what was read after the change shows.
  updatedAt = "2026-11-15T00:01:00Z";
  tick(60);
  assert.equal(await maxAgeOfRead(), 0);
  tick(20.5);
  assert.equal(await maxAgeOfRead(), 20.5);

  // Changed while a read ran, which may have read GitHub before: what that read left is not used either.
  whileRead = async () => {
    whileRead = undefined;
    updatedAt = "2026-11-15T00:02:00Z";
    await readItems(ctx, "o/v", "feat/7-x", [], 0);
    tick(5);
  };
  await maxAgeOfRead();
  tick(10);
  assert.equal(await maxAgeOfRead(), 10);
});

test("an item asked for as the wrong kind is read as the kind it is", async () => {
  const asked: string[] = [];
  const ctx = {
    github: {
      read: async (args: string[]) => {
        const [cmd, , n] = args;
        asked.push(`${cmd} ${n}`);
        // gh issue view gives a pull request for its number; gh pr view fails on an issue's.
        if (cmd === "pr" && n === "5") throw Object.assign(new Error("Command failed"), { stderr: "GraphQL: Could not resolve to a PullRequest with the number of 5. (repository.pullRequest)" });
        const url = n === "5" ? "https://github.com/o/k/issues/5" : "https://github.com/o/k/pull/6";
        return { stdout: JSON.stringify({ number: Number(n), title: "t", url, state: n === "5" ? "OPEN" : "MERGED", headRefName: "feat/6-x" }), stderr: "" };
      },
    },
    log: () => undefined,
  } as unknown as Ctx;
  const pull = await readDetail(ctx, "o/k", "issues", 6);
  assert.deepEqual([pull.kind, pull.state, pull.head], ["pulls", "merged", "feat/6-x"]);
  assert.equal((await readDetail(ctx, "o/k", "pulls", 5)).kind, "issues");
  assert.deepEqual(asked, ["issue 6", "pr 6", "pr 5", "issue 5"]);
});

/** gh failing as it does on a GraphQL read with errors: the answer on stdout, the message on stderr. */
const ghFailure = (data: unknown, errors: unknown[], message: string) => Object.assign(new Error("Command failed: gh api graphql"), { code: 1, stdout: JSON.stringify({ data, errors }), stderr: `gh: ${message}` });

test("a repository this login cannot read fails the read of its items, and shows them again once it can", async () => {
  let readable = false;
  const ctx = {
    github: {
      read: async () => {
        if (!readable) throw ghFailure({ repository: null }, [{ type: "NOT_FOUND", path: ["repository"] }], "Could not resolve to a Repository with the name 'o/private'.");
        return { stdout: JSON.stringify({ data: { repository: { pulls: { nodes: [] }, n7: { __typename: "Issue", number: 7, title: "t", state: "OPEN", url: "https://github.com/o/private/issues/7" }, n8: { __typename: "Issue", number: 8, title: "u", state: "OPEN", url: "https://github.com/o/private/issues/8" } } } }), stderr: "" };
      },
    },
    log: () => undefined,
  } as unknown as Ctx;
  // Not as numbers GitHub does not have: the branch's number and the ones added stay asked for.
  await assert.rejects(readItems(ctx, "o/private", "feat/7-x", [8], 0), (e: { stderr?: string }) => /Could not resolve to a Repository/.test(e.stderr ?? ""));
  readable = true;
  const items = await readItems(ctx, "o/private", "feat/7-x", [8], 0);
  assert.equal(items.named?.number, 7);
  assert.deepEqual(items.added.map((i) => i.number), [8]);
});

test("numbers added under a name GitHub no longer has come off when the origin names another repository", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "github-implement-test-"));
  await fs.writeFile(path.join(dir, "worktrees.json"), JSON.stringify({ worktrees: { "/w": { repo: "o/gone", added: [8], seenAt: 1 } } }));
  begin(dir, {}, () => undefined);
  const ctx = {
    github: {
      read: async (args: string[]) => {
        if (args.some((a) => a.includes("a: repository"))) throw ghFailure({ a: null, b: { id: "R_1" } }, [{ type: "NOT_FOUND", path: ["a"] }], "Could not resolve to a Repository with the name 'o/gone'.");
        return { stdout: JSON.stringify({ data: { repository: { pulls: { nodes: [] } } } }), stderr: "" };
      },
    },
    log: () => undefined,
  } as unknown as DaemonContext;
  try {
    const read = (await itemsOp.run({ repo: "o/now", worktree: "/w" }, ctx)) as WorktreeItems;
    assert.deepEqual(read.added, []);
  } finally {
    end();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("an issue closed as a duplicate is told apart from one closed as done", () => {
  const raw = { __typename: "Issue", number: 5, title: "t", state: "CLOSED", stateReason: "DUPLICATE", url: "https://github.com/o/r/issues/5" };
  assert.equal(parseItems(JSON.stringify({ data: { repository: { n5: raw } } }), 5, [], 0).named?.stateReason, "duplicate");
  assert.equal(parseDetail(JSON.stringify(raw), "issues", [])?.stateReason, "duplicate");
});

test("a read too large for one message leaves out the oldest comments and reviews", () => {
  const at = (minute: number) => `2026-11-18T00:${String(minute).padStart(2, "0")}:00Z`;
  const item: GitHubItemDetail = {
    kind: "pulls",
    number: 1,
    title: "t",
    url: "https://github.com/o/r/pull/1",
    createdAt: at(0),
    updatedAt: at(9),
    labels: [],
    state: "open",
    assignees: [],
    body: "",
    comments: [1, 3, 5, 7].map((m) => ({ createdAt: at(m), body: "あ".repeat(100) })),
    commentsLeftOut: 2,
    reviews: [2, 6].map((m) => ({ submittedAt: at(m), state: "commented" as const, body: "い".repeat(100) })),
  };
  assert.equal(fitDetail(item, 1_000_000), item);
  const max = Buffer.byteLength(JSON.stringify(item)) - 900;
  const fit = fitDetail(item, max);
  assert.ok(Buffer.byteLength(JSON.stringify(fit)) <= max);
  // 1, 2 and 3 are the oldest: 2 comments and 1 review, on top of the comments already left out.
  assert.deepEqual(fit.comments?.map((c) => c.createdAt), [at(5), at(7)]);
  assert.deepEqual(fit.reviews?.map((r) => r.submittedAt), [at(6)]);
  assert.equal(fit.commentsLeftOut, 4);
  assert.equal(fit.reviewsLeftOut, 1);
});

test("after the reload button, the reads of the repository use only what gh read since the press", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 5_000_000 });
  const maxAges: (number | undefined)[] = [];
  const ctx = {
    github: {
      read: async (_args: string[], o: GitHubReadOptions = {}) => {
        maxAges.push(o.maxAgeSeconds);
        return { stdout: JSON.stringify({ data: { repository: { pulls: { nodes: [] } } } }), stderr: "" };
      },
    },
    log: () => undefined,
  } as unknown as Ctx;
  await readItems(ctx, "o/fresh", "main", [], 55);
  await itemRead(ctx, "o/fresh", 3)(["api", "graphql", "-f", "query=…"]);
  assert.deepEqual(maxAges.splice(0), [55, 55]);
  askFresh("O/Fresh");
  t.mock.timers.tick(2000);
  await readItems(ctx, "o/fresh", "main", [], 55);
  await itemRead(ctx, "o/fresh", 3)(["api", "graphql", "-f", "query=…"]);
  assert.deepEqual(maxAges.splice(0), [2, 2]);
  // Other repositories, and the same one once the interval has passed, read as before.
  await readItems(ctx, "o/other", "main", [], 55);
  t.mock.timers.tick(60_000);
  await readItems(ctx, "o/fresh", "main", [], 55);
  assert.deepEqual(maxAges, [55, 55]);
});

test("the background reads the rest of a worktree when one of its items cannot be read", async () => {
  const pull = (number: number) => ({ __typename: "PullRequest", number, title: `p${number}`, state: "OPEN", isDraft: false, url: `https://github.com/o/again/pull/${number}` });
  const read: string[] = [];
  const logged: unknown[][] = [];
  const ctx = {
    github: {
      read: async (args: string[]) => {
        if (args[0] === "api") return { stdout: JSON.stringify({ data: { repository: { pulls: { nodes: [pull(8), pull(9)] }, n7: { __typename: "Issue", number: 7, title: "i", state: "OPEN", url: "https://github.com/o/again/issues/7" } } } }), stderr: "" };
        read.push(args[2] ?? "");
        if (args[2] === "8") throw new Error("gh: HTTP 502");
        return { stdout: JSON.stringify({ number: Number(args[2]), title: "t", url: `https://github.com/o/again/${args[0] === "issue" ? "issues" : "pull"}/${args[2]}`, state: "OPEN" }), stderr: "" };
      },
    },
    log: (...a: unknown[]) => void logged.push(a),
  } as unknown as Ctx;
  await readAgain(ctx, { repo: "o/again", branch: "feat/7-x", added: [] }, () => false);
  assert.deepEqual(read, ["7", "8", "9"]);
  assert.equal(logged.length, 1);
});

test("the reason a conversation was locked for, as GitHub's REST API names it, is the one gh locks it with again", () => {
  const reason = (r: string) => parseLocked(JSON.stringify({ locked: true, reason: r })).reason;
  assert.equal(reason("off-topic"), "off_topic");
  assert.equal(reason("too heated"), "too_heated");
  assert.equal(reason("resolved"), "resolved");
  assert.equal(reason("constructor"), undefined);
});
