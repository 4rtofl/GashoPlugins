import assert from "node:assert/strict";
import { test } from "node:test";
import { detailArgs, listArgs, parseDetail, parseList, requestedQuery } from "../src/daemon/gh.ts";
import { askInstruction, markInstruction, mergeInstruction, mergeMethodOf, REVIEW_HEADING } from "../src/instructions.ts";
import { askOf, latestMark, readMark, reviewProgress, sameHead, withoutMark, working, type ReviewMark } from "../src/verdict.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "fedcba9876543210fedcba9876543210fedcba98";
const PR = { repo: "o/r", number: 5, title: "直す", url: "https://github.com/o/r/pull/5", branch: "feat/5-fix" };

test("mark: the hidden mark of a comment is read, the last when there are several; anything else is no mark", () => {
  assert.deepEqual(readMark(`${REVIEW_HEADING}\n\n良さそうです。\n<!-- gasho-review verdict=mergeable sha=${SHA} -->`), { verdict: "mergeable", sha: SHA });
  assert.deepEqual(readMark(`<!-- gasho-review verdict=mergeable sha=${SHA} -->\n<!--gasho-review  verdict=CHANGES sha=ABCDEF1-->`), { verdict: "changes", sha: "abcdef1" });
  assert.equal(readMark("<!-- gasho-review verdict=approve sha=abcdef1 -->"), undefined);
  assert.equal(readMark("<!-- gasho-review verdict=mergeable sha=xyz -->"), undefined);
  assert.equal(readMark("gasho-review verdict=mergeable sha=abcdef1"), undefined);
  assert.equal(withoutMark(`本文\n<!-- gasho-review verdict=changes sha=${SHA} -->\n`), "本文");
});

test("mark: only the comments I wrote count, the latest first", () => {
  const c = (mine: boolean, verdict: string, sha: string, n: number) => ({ mine, body: `<!-- gasho-review verdict=${verdict} sha=${sha} -->`, url: `u${n}`, at: `2026-11-1${n}T00:00:00Z` });
  assert.deepEqual(latestMark([c(true, "changes", OTHER, 1), c(true, "mergeable", SHA, 2), c(false, "changes", SHA, 3), { mine: true, body: "ありがとう", url: "u4" }]), {
    verdict: "mergeable",
    sha: SHA,
    url: "u2",
    at: "2026-11-12T00:00:00Z",
  });
  assert.equal(latestMark([c(false, "mergeable", SHA, 1)]), undefined);
  assert.equal(latestMark([]), undefined);
});

test("progress: reviewing, mergeable, changes or stale, from the mark, the head now and the sessions at work", () => {
  const mark = (verdict: "mergeable" | "changes", sha = SHA): ReviewMark => ({ verdict, sha, url: "u" });
  const open = { state: "open", head: SHA };
  assert.equal(reviewProgress(open, false), undefined);
  assert.equal(reviewProgress(open, true), "reviewing");
  assert.equal(reviewProgress({ ...open, mark: mark("mergeable") }, false), "mergeable");
  // A session at work does not hide a verdict on the head now (it may be merging).
  assert.equal(reviewProgress({ ...open, mark: mark("changes") }, true), "changes");
  assert.equal(reviewProgress({ ...open, mark: mark("mergeable", OTHER) }, false), "stale");
  // A push came after the review, and the session reviews again.
  assert.equal(reviewProgress({ ...open, mark: mark("mergeable", OTHER) }, true), "reviewing");
  // A hand-written short sha names the head it starts.
  assert.equal(reviewProgress({ ...open, mark: mark("mergeable", SHA.slice(0, 7)) }, false), "mergeable");
  assert.equal(reviewProgress({ state: "merged", head: SHA, mark: mark("mergeable") }, true), undefined);
  assert.equal(sameHead(SHA, undefined), false);
  assert.equal(sameHead("0123456", OTHER), false);
});

test("progress: a session works when busy, waiting for an answer, or with inputs waiting, in the folder or below it", () => {
  const dir = "/w/review-5";
  assert.equal(working([{ cwd: dir, status: "idle" }], dir), false);
  assert.equal(working([{ cwd: dir, status: "busy" }], dir), true);
  assert.equal(working([{ cwd: `${dir}/sub`, status: "waiting" }], dir), true);
  assert.equal(working([{ cwd: dir, status: "idle", pendingInputs: 1 }], dir), true);
  assert.equal(working([{ cwd: `${dir}0`, status: "busy" }], dir), false);
});

test("ask: merge for mergeable, send back for changes (mend on my own), none for the rest; a fork it cannot push to with a conflict is blocked", () => {
  assert.equal(askOf({}, "mergeable")?.kind, "merge");
  assert.equal(askOf({}, "mergeable")?.blocked, undefined);
  assert.equal(askOf({ fork: true, conflict: true }, "mergeable")?.blocked?.includes("push できない"), true);
  assert.equal(askOf({ fork: true, conflict: true, canModify: true }, "mergeable")?.blocked, undefined);
  assert.equal(askOf({ fork: true, conflict: true, own: true }, "mergeable")?.blocked, undefined);
  assert.equal(askOf({ fork: true }, "mergeable")?.blocked, undefined);
  assert.deepEqual(askOf({}, "changes"), { kind: "sendBack", label: "差し戻す" });
  assert.deepEqual(askOf({ own: true }, "changes"), { kind: "fix", label: "修正してもらう" });
  assert.equal(askOf({}, "stale"), undefined);
  assert.equal(askOf({}, "reviewing"), undefined);
  assert.equal(askOf({}, undefined), undefined);
});

test("instructions: the review is posted with the heading and the mark; merge, send back and mend say what to do", () => {
  const mark: ReviewMark = { verdict: "mergeable", sha: SHA, url: "https://github.com/o/r/pull/5#issuecomment-1" };
  const m = markInstruction(PR);
  assert.ok(m.includes(REVIEW_HEADING));
  assert.ok(m.includes("<!-- gasho-review verdict=mergeable sha=<SHA> -->"));
  assert.ok(m.includes("gh pr comment 5 --body-file <ファイル> --repo o/r"));
  assert.ok(m.includes("gh pr view 5 --json headRefOid -q .headRefOid --repo o/r"));
  // The mark the instruction shows is one the page reads.
  assert.deepEqual(readMark(m.replace("<SHA>", SHA)), { verdict: "mergeable", sha: SHA });

  const merge = mergeInstruction(PR, mark, { method: "squash", deleteBranch: true, own: false, fork: false, canPush: true });
  assert.ok(merge.includes("gh pr review 5 --approve"));
  assert.ok(merge.includes(`gh pr merge 5 --squash --match-head-commit <SHA> --repo o/r`));
  assert.ok(merge.includes(SHA));
  assert.ok(merge.includes(mark.url));
  assert.ok(merge.includes("rebase ではなく merge"));
  assert.ok(merge.includes("gh api -X DELETE repos/o/r/git/refs/heads/feat/5-fix"));
  assert.match(merge, /^1\. .*コンフリクト/m);
  assert.match(merge, /^3\. .*--approve/m);
  assert.match(merge, /^4\. .*gh pr merge/m);

  const own = mergeInstruction(PR, mark, { method: "merge", deleteBranch: false, own: true, fork: false, canPush: true });
  assert.ok(!own.includes("--approve"));
  assert.ok(own.includes("approve はできません"));
  assert.ok(!own.includes("git/refs/heads"));

  const fork = askInstruction("merge", { ...PR, fork: true }, mark, { method: "rebase", deleteBranch: true });
  assert.ok(fork.includes("head には push できない"));
  assert.ok(fork.includes("--rebase"));
  // A fork's branch is never deleted.
  assert.ok(!fork.includes("git/refs/heads"));
  assert.ok(askInstruction("merge", { ...PR, fork: true, canModify: true }, mark, { method: "merge", deleteBranch: true }).includes("rebase ではなく merge"));

  const back = askInstruction("sendBack", PR, { ...mark, verdict: "changes" }, { method: "merge", deleteBranch: true });
  assert.ok(back.includes("gh pr review 5 --request-changes --body-file <ファイル> --repo o/r"));
  assert.ok(back.includes(mark.url));
  const fix = askInstruction("fix", PR, { ...mark, verdict: "changes" }, { method: "merge", deleteBranch: true });
  assert.ok(fix.includes("feat/5-fix") && fix.includes("push") && !fix.includes("--request-changes"));

  assert.equal(mergeMethodOf("squash"), "squash");
  assert.equal(mergeMethodOf("octopus"), "merge");
  assert.equal(mergeMethodOf(undefined), "merge");
});

test("gh: the list reads the marks of the latest comments, whether I opened it, its conflict and whether the maintainers may push", () => {
  const args = listArgs({ requested: requestedQuery(""), watched: [], lookups: [] });
  const query = args[args.indexOf("-f") + 1] ?? "";
  assert.match(query, /recent: comments\(last: 10\) \{ nodes \{ viewerDidAuthor body url createdAt \} \}/);
  assert.match(query, /viewerDidAuthor mergeable maintainerCanModify/);
  const pr = (number: number, over: Record<string, unknown> = {}) => ({
    number,
    title: `t${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    state: "OPEN",
    headRefName: `feat/${number}`,
    headRefOid: SHA.toUpperCase(),
    repository: { nameWithOwner: "o/r" },
    ...over,
  });
  const answer = parseList(
    JSON.stringify({
      data: {
        req: {
          issueCount: 2,
          nodes: [
            pr(1, {
              viewerDidAuthor: true,
              mergeable: "CONFLICTING",
              isCrossRepository: true,
              maintainerCanModify: true,
              recent: {
                nodes: [
                  { viewerDidAuthor: true, body: `<!-- gasho-review verdict=changes sha=${SHA} -->`, url: "c1", createdAt: "2026-11-16T00:00:00Z" },
                  { viewerDidAuthor: false, body: `<!-- gasho-review verdict=mergeable sha=${SHA} -->`, url: "c2" },
                ],
              },
            }),
            pr(2, { mergeable: "MERGEABLE", recent: { nodes: [] } }),
          ],
        },
      },
    }),
    { watched: 0, lookups: [] },
  );
  const [a, b] = answer.requested.prs;
  assert.deepEqual([a?.head, a?.own, a?.conflict, a?.canModify, a?.fork, a?.mark], [SHA, true, true, true, true, { verdict: "changes", sha: SHA, url: "c1", at: "2026-11-16T00:00:00Z" }]);
  assert.deepEqual([b?.own, b?.conflict, b?.canModify, b?.mark], [undefined, undefined, undefined, undefined]);
});

test("gh: the side panel reads the body, the latest comments with the verdict among them, and the checks of the head", () => {
  const args = detailArgs("o/r", 5);
  const query = args[args.indexOf("-f") + 1] ?? "";
  assert.match(query, /pullRequest\(number: 5\)/);
  assert.match(query, /comments\(last: 30\) \{ totalCount/);
  assert.match(query, /\.\.\. on CheckRun \{ name status conclusion detailsUrl \}/);
  assert.ok(args.includes("owner=o") && args.includes("name=r"));

  const d = parseDetail(
    JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            number: 5,
            title: "直す",
            url: "https://github.com/o/r/pull/5",
            state: "OPEN",
            headRefName: "feat/5-fix",
            headRefOid: SHA,
            repository: { nameWithOwner: "o/r" },
            body: "本文",
            // The latest few hold no mark; an older comment of the 30 does.
            recent: { nodes: [{ viewerDidAuthor: false, body: "見ました", url: "c3" }] },
            comments: {
              totalCount: 45,
              nodes: [
                { author: { login: "me" }, viewerDidAuthor: true, body: `${REVIEW_HEADING}\n<!-- gasho-review verdict=mergeable sha=${SHA} -->`, url: "c1", createdAt: "2026-11-16T00:00:00Z" },
                { author: { login: "you" }, viewerDidAuthor: false, body: "見ました", url: "c3" },
                { author: null, body: 3, url: "bad" },
              ],
            },
            commits: {
              nodes: [
                {
                  commit: {
                    statusCheckRollup: {
                      contexts: {
                        nodes: [
                          { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://github.com/o/r/actions/runs/1" },
                          { __typename: "CheckRun", name: "build", status: "IN_PROGRESS", conclusion: null, detailsUrl: "javascript:alert(1)" },
                          { __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "TIMED_OUT" },
                          { __typename: "StatusContext", context: "ci/legacy", state: "ERROR", targetUrl: "https://ci.example.com/1", description: "壊れた" },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    }),
  );
  assert.ok(d);
  assert.equal(d.body, "本文");
  assert.deepEqual(d.pr.mark, { verdict: "mergeable", sha: SHA, url: "c1", at: "2026-11-16T00:00:00Z" });
  assert.deepEqual(
    d.comments.map((c) => [c.author, c.mine, c.url]),
    [
      ["me", true, "c1"],
      ["you", false, "c3"],
    ],
  );
  assert.equal(d.commentsMore, 43);
  assert.deepEqual(d.checks, [
    { name: "test", state: "success", url: "https://github.com/o/r/actions/runs/1" },
    { name: "build", state: "pending" },
    { name: "lint", state: "failure" },
    { name: "ci/legacy", state: "failure", url: "https://ci.example.com/1", description: "壊れた" },
  ]);
  assert.equal(parseDetail(JSON.stringify({ data: { repository: { pullRequest: null } } })), undefined);
});
