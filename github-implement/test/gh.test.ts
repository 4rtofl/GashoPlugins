import assert from "node:assert/strict";
import { test } from "node:test";
import comments from "../src/daemon/detail/comments.ts";
import commits from "../src/daemon/detail/commits.ts";
import type { GitHubReadOptions } from "@gasho/plugin-sdk/daemon";
import { itemRead, readItems, type Ctx } from "../src/daemon/core.ts";
import { branchArg, branchNumber, detailArgs, itemsQueryArgs, itemVersions, parseDetail, parseItems, repoArg } from "../src/daemon/gh.ts";
import { commentArgs } from "../src/daemon/ops/comment.ts";
import { editArgs } from "../src/daemon/ops/edit.ts";
import { stateArgs } from "../src/daemon/ops/state.ts";
import { numberFrom } from "../src/web/number.ts";

test("a branch is named after the issue in its number", () => {
  assert.equal(branchNumber("feat/17-resume-outside"), 17);
  assert.equal(branchNumber("fix/16-plugin-css-override"), 16);
  assert.equal(branchNumber("main"), undefined);
  assert.equal(branchNumber("feat/plugins"), undefined);
  assert.equal(branchNumber(undefined), undefined);
});

test("one query reads the branch's pull requests and every number asked for, each once", () => {
  const args = itemsQueryArgs("4rtoflow/Gasho", "feat/30-plugin-tabs", [30, 17, 30]);
  const query = args[args.indexOf("-f") + 1] ?? "";
  assert.match(query, /\$branch: String!/);
  // Inside PullRequest nodes, a fragment on Issue is an error of the whole query.
  const pulls = /pullRequests\(headRefName: \$branch.*? n30:/.exec(query)?.[0] ?? "";
  assert.match(pulls, /\{ nodes \{ __typename number title state isDraft url updatedAt /);
  assert.doesNotMatch(pulls, /on Issue/);
  assert.equal(query.match(/n30: issueOrPullRequest/g)?.length, 1);
  assert.match(query, /n17: issueOrPullRequest\(number: 17\)/);
  assert.ok(args.includes("branch=feat/30-plugin-tabs") && args.includes("owner=4rtoflow") && args.includes("name=Gasho"));

  // Without a branch, the query has no $branch (GitHub refuses a variable it does not use) and still asks for a field.
  const bare = itemsQueryArgs("4rtoflow/Gasho", undefined, []);
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
            { __typename: "PullRequest", number: 36, title: "タブを足す", state: "OPEN", isDraft: true, url: "https://github.com/4rtoflow/Gasho/pull/36" },
            { __typename: "PullRequest", number: 35, title: "elsewhere", state: "OPEN", url: "javascript:alert(1)" },
          ],
        },
        // The tab of an issue closed as not planned looks apart from one closed as done.
        n30: { __typename: "Issue", number: 30, title: "タブの仕組み", state: "CLOSED", stateReason: "NOT_PLANNED", url: "https://github.com/4rtoflow/Gasho/issues/30" },
        n24: { __typename: "PullRequest", number: 24, title: "サイドバー", state: "MERGED", isDraft: false, url: "https://github.com/4rtoflow/Gasho/pull/24" },
        n99: null,
      },
    },
    errors: [{ type: "NOT_FOUND", path: ["repository", "n99"] }],
  });
  assert.deepEqual(parseItems(json, 30, [24, 99], 1000), {
    named: { kind: "issues", number: 30, title: "タブの仕組み", state: "closed", stateReason: "not_planned", url: "https://github.com/4rtoflow/Gasho/issues/30" },
    pulls: [{ kind: "pulls", number: 36, title: "タブを足す", state: "open", draft: true, url: "https://github.com/4rtoflow/Gasho/pull/36" }],
    added: [{ kind: "pulls", number: 24, title: "サイドバー", state: "merged", url: "https://github.com/4rtoflow/Gasho/pull/24" }],
    missing: [99],
    at: 1000,
  });
});

test("what the browser sends never becomes a flag of gh", () => {
  assert.throws(() => repoArg("--repo"));
  assert.throws(() => repoArg("-R/x"));
  assert.throws(() => repoArg("a/b c"));
  assert.equal(repoArg("4rtoflow/Gasho"), "4rtoflow/Gasho");
  assert.throws(() => branchArg("--upload-pack=x"));
  assert.throws(() => branchArg("a..b"));
  assert.equal(branchArg("feat/4-github-almighty"), "feat/4-github-almighty");
  // Text that starts with "-" stays the value of its flag.
  assert.deepEqual(commentArgs("o/r", "issues", 3, "--repo x/y"), ["issue", "comment", "3", "--repo", "o/r", "--body=--repo x/y"]);
  assert.deepEqual(editArgs("o/r", "pulls", 3, { title: "-t", addAssignees: ["@me"], removeLabels: ["bug"] }), ["pr", "edit", "3", "--repo", "o/r", "--title=-t", "--add-assignee=@me", "--remove-label=bug"]);
  assert.deepEqual(stateArgs("o/r", "issues", 3, "close", "not_planned"), ["issue", "close", "3", "--repo", "o/r", "--reason=not planned"]);
  assert.deepEqual(stateArgs("o/r", "pulls", 3, "close", "not_planned"), ["pr", "close", "3", "--repo", "o/r"]);
});

test("a number is taken from 17, #17, or a URL of the same repository only", () => {
  assert.equal(numberFrom(" #17 ", "4rtoflow/Gasho"), 17);
  assert.equal(numberFrom("https://github.com/4rtoflow/Gasho/pull/36/files", "4rtoflow/Gasho"), 36);
  assert.equal(numberFrom("https://github.com/4rtoflow/GashoPlugins/issues/4", "4rtoflow/Gasho"), undefined);
  assert.equal(numberFrom("abc", "4rtoflow/Gasho"), undefined);
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
