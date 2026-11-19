import assert from "node:assert/strict";
import { test } from "node:test";
import { detailArgs, listArgs, parseDetail, parseList, upperSearches } from "../src/daemon/gh.ts";
import { askEffort, askInstruction, effortFor, markInstruction, mergeInstruction, mergeMethodOf, REVIEW_EFFORT, REVIEW_HEADING, reviewInstruction } from "../src/instructions.ts";
import { ASK_RECHECK_MS, ASK_SETTLE_MS, askEndUnseen, askOf, askRechecking, askRunning, latestMark, readMark, reviewProgress, sameHead, sentBack, underway, withoutMark, workEndUnseen, working, workRechecking, type Asked, type Recheck, type ReviewMark } from "../src/verdict.ts";

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
  assert.equal(working([{ cwd: dir, status: "idle", background: [{ id: "t" }] }], dir), true);
  assert.equal(working([{ cwd: dir, status: "idle", background: [] }], dir), false);
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
  // "worktree を作る" and "まとめてレビューさせる" send the template filled in, then the mark's instruction.
  assert.equal(reviewInstruction({ body: "#{number} {title} をレビューして" }, PR), `#5 直す をレビューして\n${m}`);

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

test("severity: the review sorts its findings into High, Medium and Low, and only a High one makes it changes", () => {
  const m = markInstruction(PR);
  assert.match(m, /^- High: マージすると実害が出るもの/m);
  assert.match(m, /^- Medium: 直したほうがよいが、マージを止めるほどではないもの/m);
  assert.match(m, /^- Low: 好みや細かい改善/m);
  assert.ok(m.includes("`### High`・`### Medium`・`### Low`"));
  assert.ok(m.includes("High の指摘が1件以上あれば changes、High の指摘がなければ mergeable"));
  assert.ok(m.includes("Medium・Low だけのときも、指摘がないときも mergeable"));
});

test("scope: the review settles the pull request's scope first, and what is outside it never counts", () => {
  const m = markInstruction(PR);
  assert.ok(m.indexOf("この Pull request の範囲を確かめて") < m.indexOf("- High: マージすると実害が出るもの"));
  assert.ok(m.includes("完了の条件は、書かれている以上に広げて解釈しないでください"));
  assert.ok(m.includes("その変更で新しく起きる問題"));
  assert.ok(m.includes("前からある不具合でも、完了の条件に書かれていれば範囲内"));
  assert.ok(m.includes("High・Medium・Low には入れず、`### 範囲外（参考）` の見出しに"));
  assert.ok(m.includes("範囲外（参考）の指摘は verdict に含めません"));

  const mark: ReviewMark = { verdict: "changes", sha: SHA, url: "https://github.com/o/r/pull/5#issuecomment-1" };
  const merge = { method: "merge", deleteBranch: true } as const;
  assert.ok(askInstruction("sendBack", PR, mark, merge).includes("「範囲外（参考）」の指摘は、本文に入れないでください"));
  assert.ok(askInstruction("fix", PR, mark, merge).includes("「範囲外（参考）」の指摘は、この Pull request では直さないでください"));
});

test("severity: send back and mend must deal with the High findings, and say what becomes of Medium and Low", () => {
  const mark: ReviewMark = { verdict: "changes", sha: SHA, url: "https://github.com/o/r/pull/5#issuecomment-1" };
  const merge = { method: "merge", deleteBranch: true } as const;

  const back = askInstruction("sendBack", PR, mark, merge);
  assert.ok(back.includes("必ず直してほしい点として High の指摘"));
  assert.ok(back.includes("Medium・Low の指摘があれば、High とは分けて「参考」の見出しの下に"));

  const fix = askInstruction("fix", PR, mark, merge);
  assert.ok(fix.includes("High の指摘をすべて"));
  assert.ok(fix.includes("Medium・Low の指摘は直さなくてかまいません"));

  // A review posted before the severities still has what it asked to mend mended.
  for (const text of [back, fix]) assert.ok(text.includes("分かれていないとき（この分け方を始める前のレビュー）は、直すとされた点をすべて High の指摘として扱って"));
});

test("severity: a comment from before the severities and one sorted into them are read the same way", () => {
  assert.deepEqual(readMark(`${REVIEW_HEADING}\n\n直すところがあります。\n<!-- gasho-review verdict=changes sha=${SHA} -->`), { verdict: "changes", sha: SHA });
  const sorted = `${REVIEW_HEADING}\n\n### High\nなし\n\n### Medium\n- テストが足りない\n\n### Low\nなし\n\n<!-- gasho-review verdict=mergeable sha=${SHA} -->`;
  assert.deepEqual(readMark(sorted), { verdict: "mergeable", sha: SHA });
  assert.ok(withoutMark(sorted).endsWith("### Low\nなし"));
});

test("effort: the review at high, merge and send back at medium, mend at the session's own; switched only where gasho-daemon can", () => {
  assert.equal(REVIEW_EFFORT, "high");
  assert.equal(askEffort("merge"), "medium");
  assert.equal(askEffort("sendBack"), "medium");
  assert.equal(askEffort("fix"), undefined);

  const can = { features: ["model", "effort", "ultracode", "files"] } satisfies Parameters<typeof effortFor>[0];
  assert.deepEqual(effortFor(can, REVIEW_EFFORT), { effort: "high" });
  assert.deepEqual(effortFor(can, askEffort("merge")), { effort: "medium" });
  assert.deepEqual(effortFor(can, askEffort("fix")), {});
  // A gasho-daemon older than 0.6.0 lists no features, and one may list them without effort.
  assert.deepEqual(effortFor({}, REVIEW_EFFORT), {});
  assert.deepEqual(effortFor({ features: ["model", "files"] }, REVIEW_EFFORT), {});
});

test("gh: the list reads the marks of the latest comments, whether I opened it, its conflict and whether the maintainers may push", () => {
  const args = listArgs({ ...upperSearches("", []), watched: [], counts: [], kept: [], lookups: [] });
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
    { watched: [], counts: [], kept: [], lookups: [] },
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

test("ask running: once asked, the row shows it is being done while a session in the worktree works", () => {
  const merge = askOf({}, "mergeable");
  const mark = { sha: SHA };
  const asked = { kind: "merge" as const, sha: SHA, at: 1_000_000 };
  const later = asked.at + ASK_SETTLE_MS;
  // A moment after it was asked, before the session's state comes.
  assert.equal(askRunning(merge, mark, { working: false, asked, now: asked.at + 1000 }), true);
  assert.equal(askRunning(merge, mark, { working: true, asked, now: later }), true);
  // Done: the button comes back (a merge that did not happen can be asked again).
  assert.equal(askRunning(merge, mark, { working: false, asked, now: later }), false);
  // A session at work on the review itself, with nothing asked.
  assert.equal(askRunning(merge, mark, { working: true, now: later }), false);
  // Asked of another verdict, or something else.
  assert.equal(askRunning(merge, { sha: OTHER }, { working: true, asked, now: later }), false);
  assert.equal(askRunning(askOf({}, "changes"), mark, { working: true, asked, now: asked.at }), false);
  // Kept to remove the worktree after (asked on another page, or before the page was opened again).
  const followed = { kind: "merge" as const, sha: SHA };
  assert.equal(askRunning(merge, mark, { working: true, followed, now: later }), true);
  assert.equal(askRunning(merge, mark, { working: false, followed, now: later }), false);
  assert.equal(askRunning(undefined, mark, { working: true, asked, now: asked.at }), false);
  // Kept from a merge of an earlier verdict that did not happen, or from before it named the head: nothing is asked of this one.
  assert.equal(askRunning(merge, mark, { working: true, followed: { kind: "merge", sha: OTHER }, now: later }), false);
  assert.equal(askRunning(merge, mark, { working: true, followed: { kind: "merge" }, now: later }), false);
  assert.equal(askRunning(askOf({}, "changes"), mark, { working: true, followed, now: later }), false);
});

test("ask rechecking: once the work ended, the row waits for the list read from GitHub after it", () => {
  const merge = askOf({}, "mergeable");
  const mark = { sha: SHA };
  const ended = 1_000_000;
  const reading: Recheck = { kind: "merge", sha: SHA, ended };
  const read: Recheck = { ...reading, refreshed: ended + 2000 };
  // GitHub is being read.
  assert.equal(askRechecking(merge, mark, { recheck: reading, listedAt: ended + 1000, now: ended + 1000 }), true);
  // It was read, and the list that gives has not come yet.
  assert.equal(askRechecking(merge, mark, { recheck: read, listedAt: ended - 5000, now: ended + 2100 }), true);
  assert.equal(askRechecking(merge, mark, { recheck: read, now: ended + 2100 }), true);
  // It has come: the row shows what the list says.
  assert.equal(askRechecking(merge, mark, { recheck: read, listedAt: ended + 2200, now: ended + 2300 }), false);
  // It does not wait for ever, when no list comes.
  assert.equal(askRechecking(merge, mark, { recheck: reading, now: ended + ASK_RECHECK_MS - 1 }), true);
  assert.equal(askRechecking(merge, mark, { recheck: reading, now: ended + ASK_RECHECK_MS }), false);
  // Nothing ended, or the end of something else.
  assert.equal(askRechecking(merge, mark, { now: ended }), false);
  assert.equal(askRechecking(undefined, mark, { recheck: reading, now: ended }), false);
  assert.equal(askRechecking(merge, { sha: OTHER }, { recheck: reading, now: ended }), false);
  assert.equal(askRechecking(askOf({}, "changes"), mark, { recheck: reading, now: ended }), false);
});

test("ask end unseen: what was asked ended while the page was left, and GitHub was not read for it since", () => {
  const merge = askOf({}, "mergeable");
  const mark = { sha: SHA };
  const asked = { kind: "merge" as const, sha: SHA, at: 1_000_000 };
  assert.equal(askEndUnseen(merge, mark, { running: false, asked }), true);
  // Read again for an earlier ask only.
  assert.equal(askEndUnseen(merge, mark, { running: false, asked, recheck: { kind: "merge", sha: SHA, ended: asked.at - 5000 } }), true);
  // Still being done: its end is yet to come.
  assert.equal(askEndUnseen(merge, mark, { running: true, asked }), false);
  // A row saw it end, and GitHub was read again.
  assert.equal(askEndUnseen(merge, mark, { running: false, asked, recheck: { kind: "merge", sha: SHA, ended: asked.at + 5000 } }), false);
  // Nothing asked on this screen, of another verdict, or something else.
  assert.equal(askEndUnseen(merge, mark, { running: false }), false);
  assert.equal(askEndUnseen(merge, { sha: OTHER }, { running: false, asked }), false);
  assert.equal(askEndUnseen(askOf({}, "changes"), mark, { running: false, asked }), false);
  // Merged by now, or no verdict.
  assert.equal(askEndUnseen(undefined, mark, { running: false, asked }), false);
  assert.equal(askEndUnseen(merge, undefined, { running: false, asked }), false);
});

test("sent back: once I requested changes after the review's comment, the row has no 差し戻す", () => {
  const at = "2026-11-18T10:00:00Z";
  const after = "2026-11-18T10:05:00Z";
  const before = "2026-11-18T09:00:00Z";
  assert.equal(sentBack({ changesRequestedAt: after, mark: { at } }), true);
  assert.equal(sentBack({ changesRequestedAt: at, mark: { at } }), true);
  // Of an earlier round, or nothing to tell by.
  assert.equal(sentBack({ changesRequestedAt: before, mark: { at } }), false);
  assert.equal(sentBack({ mark: { at } }), false);
  assert.equal(sentBack({ changesRequestedAt: after }), false);
  assert.equal(sentBack({ changesRequestedAt: "not a time", mark: { at } }), false);

  assert.equal(askOf({ changesRequestedAt: after, mark: { at } }, "changes"), undefined);
  assert.equal(askOf({ changesRequestedAt: before, mark: { at } }, "changes")?.kind, "sendBack");
  // My own pull request cannot be sent back: it is mended.
  assert.equal(askOf({ own: true, changesRequestedAt: after, mark: { at } }, "changes")?.kind, "fix");
  assert.equal(askOf({ changesRequestedAt: after, mark: { at } }, "mergeable")?.kind, "merge");
});

test("underway: while a session works in the worktree, no button asks for more, whoever asked it", () => {
  const merge = askOf({}, "mergeable");
  const mark = { sha: SHA };
  const now = 1_000_000;
  const quiet = { working: false, reviewing: false, now };
  assert.equal(underway(merge, mark, quiet), undefined);
  // Nothing was asked here (the page was opened again, say), and a session works.
  assert.equal(underway(merge, mark, { ...quiet, working: true }), "session");
  assert.equal(underway(undefined, undefined, { ...quiet, working: true }), "session");
  // A session sent a review works, on the verdict before it.
  assert.equal(underway(merge, mark, { ...quiet, working: true, reviewing: true }), "review");
});

test("underway: what was asked is told apart from the rest, the last one asked first", () => {
  const merge = askOf({}, "mergeable");
  const mark = { sha: SHA };
  const now = 1_000_000;
  const later = now + ASK_SETTLE_MS;
  const quiet = { working: false, reviewing: false };
  const asked: Asked = { kind: "merge", sha: SHA, at: now };
  const review: Asked = { kind: "review", sha: SHA, at: now };
  // A moment after it was sent, before the session's state comes; then for as long as a session works.
  assert.equal(underway(merge, mark, { ...quiet, asked, now }), "merge");
  assert.equal(underway(merge, mark, { ...quiet, asked: review, now }), "review");
  assert.equal(underway(undefined, undefined, { ...quiet, asked: review, now }), "review");
  assert.equal(underway(merge, mark, { ...quiet, working: true, asked: review, now: later }), "review");
  // Over.
  assert.equal(underway(merge, mark, { ...quiet, asked, now: later }), undefined);
  assert.equal(underway(merge, mark, { ...quiet, asked: review, now: later }), undefined);
  // Asked here of this verdict, with a session sent a review from before still listed.
  assert.equal(underway(merge, mark, { working: true, reviewing: true, asked, now: later }), "merge");
  // Kept by the daemon part: a review at work goes first, as it came after.
  const followed = { kind: "merge", sha: SHA } as const;
  assert.equal(underway(merge, mark, { ...quiet, working: true, followed, now: later }), "merge");
  assert.equal(underway(merge, mark, { working: true, reviewing: true, followed, now: later }), "review");
  // Asked of the verdict before: only a session at work is known.
  assert.equal(underway(merge, mark, { ...quiet, working: true, asked: { ...asked, sha: OTHER }, now: later }), "session");
});

test("workRechecking: a review's or a session's end waits for the list, whatever the verdict is by then", () => {
  const merge = askOf({}, "mergeable");
  const mark = { sha: SHA };
  const ended = 1_000_000;
  for (const kind of ["review", "session"] as const) {
    const reading: Recheck = { kind, sha: OTHER, ended };
    assert.equal(workRechecking(merge, mark, { recheck: reading, now: ended + 1000 }), kind);
    assert.equal(workRechecking(undefined, undefined, { recheck: reading, now: ended + 1000 }), kind);
    const read: Recheck = { ...reading, refreshed: ended + 2000 };
    assert.equal(workRechecking(merge, mark, { recheck: read, listedAt: ended + 1000, now: ended + 2100 }), kind);
    assert.equal(workRechecking(merge, mark, { recheck: read, listedAt: ended + 2200, now: ended + 2300 }), undefined);
    assert.equal(workRechecking(merge, mark, { recheck: reading, now: ended + ASK_RECHECK_MS }), undefined);
  }
  // What was asked of a verdict is waited for while that verdict stands.
  const asked: Recheck = { kind: "merge", sha: SHA, ended };
  assert.equal(workRechecking(merge, mark, { recheck: asked, now: ended + 1000 }), "merge");
  assert.equal(workRechecking(merge, { sha: OTHER }, { recheck: asked, now: ended + 1000 }), undefined);
  assert.equal(workRechecking(merge, mark, { now: ended }), undefined);
});

test("workEndUnseen: a review asked here that ended while the page was left is read once", () => {
  const merge = askOf({}, "mergeable");
  const mark = { sha: SHA };
  const asked: Asked = { kind: "review", sha: SHA, at: 1_000_000 };
  assert.equal(workEndUnseen(merge, mark, { going: false, asked }), true);
  assert.equal(workEndUnseen(undefined, undefined, { going: false, asked }), true);
  assert.equal(workEndUnseen(merge, mark, { going: true, asked }), false);
  assert.equal(workEndUnseen(merge, mark, { going: false, asked, recheck: { kind: "review", sha: SHA, ended: asked.at - 1 } }), true);
  assert.equal(workEndUnseen(merge, mark, { going: false, asked, recheck: { kind: "review", sha: SHA, ended: asked.at + 1 } }), false);
  // What was asked of a verdict goes by that verdict.
  assert.equal(workEndUnseen(merge, mark, { going: false, asked: { ...asked, kind: "merge" } }), true);
  assert.equal(workEndUnseen(merge, { sha: OTHER }, { going: false, asked: { ...asked, kind: "merge" } }), false);
  assert.equal(workEndUnseen(merge, mark, { going: false }), false);
});
