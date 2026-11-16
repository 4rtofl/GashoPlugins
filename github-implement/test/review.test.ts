import assert from "node:assert/strict";
import { test } from "node:test";
import type { DaemonContext } from "@gasho/plugin-sdk/daemon";
import reviewers from "../src/daemon/detail/reviewers.ts";
import { parseDetail } from "../src/daemon/gh.ts";
import review from "../src/daemon/ops/review.ts";
import changeReviewers from "../src/daemon/ops/reviewers.ts";

test("each reviewer stands where GitHub's sidebar shows them", () => {
  const at = (minute: number) => `2026-11-15T10:${String(minute).padStart(2, "0")}:00Z`;
  const json = JSON.stringify({
    number: 7,
    title: "t",
    url: "https://github.com/4rtofl/GashoPlugins/pull/7",
    state: "OPEN",
    author: { login: "totosuki" },
    reviewRequests: [
      { __typename: "User", login: "4rna-y" },
      { __typename: "Team", name: "UI", slug: "4rtofl/ui" },
      { __typename: "Team", name: "Docs", slug: "docs" },
    ],
    reviews: [
      // Asked again after reviewing: waiting, once.
      { author: { login: "4rna-y" }, state: "CHANGES_REQUESTED", submittedAt: at(1) },
      // A comment after an approval leaves the approval.
      { author: { login: "yu1sh" }, state: "APPROVED", submittedAt: at(2) },
      { author: { login: "yu1sh" }, state: "COMMENTED", submittedAt: at(5) },
      { author: { login: "octocat" }, state: "COMMENTED", submittedAt: at(3) },
      { author: { login: "octocat" }, state: "PENDING", submittedAt: at(4) },
      { author: { login: "hubot" }, state: "CHANGES_REQUESTED", submittedAt: at(7) },
      { author: { login: "hubot" }, state: "APPROVED", submittedAt: at(6) },
      { author: { login: "totosuki" }, state: "COMMENTED", submittedAt: at(8) },
      { author: { login: "monalisa" }, state: "PENDING" },
    ],
  });
  assert.deepEqual(parseDetail(json, "pulls", [reviewers])?.reviewers, [
    { name: "4rna-y", state: "requested" },
    { name: "4rtofl/ui", team: true, state: "requested" },
    { name: "4rtofl/docs", team: true, state: "requested" },
    { name: "yu1sh", state: "approved" },
    { name: "octocat", state: "commented" },
    { name: "hubot", state: "changes_requested" },
  ]);
});

const fakeGitHub = () => {
  const writes: string[][] = [];
  const ctx = { github: { write: async (args: string[]) => (writes.push(args), { stdout: "", stderr: "" }) }, log() {} } as unknown as DaemonContext;
  return { writes, ctx };
};

test("a review goes to gh with its body as the value of --body, and one that needs a body never goes without", async () => {
  const { writes, ctx } = fakeGitHub();
  await review.run({ repo: "o/r", number: 7, event: "approve" }, ctx);
  await review.run({ repo: "o/r", number: 7, event: "request_changes", body: "--repo x/y" }, ctx);
  await assert.rejects(review.run({ repo: "o/r", number: 7, event: "comment", body: " \n" }, ctx));
  await assert.rejects(review.run({ repo: "o/r", number: 7, event: "toString", body: "x" }, ctx));
  assert.deepEqual(writes, [
    ["pr", "review", "7", "--repo", "o/r", "--approve"],
    ["pr", "review", "7", "--repo", "o/r", "--request-changes", "--body=--repo x/y"],
  ]);
});

test("reviewers are logins or teams as org/slug, and never a flag of gh", async () => {
  const { writes, ctx } = fakeGitHub();
  await changeReviewers.run({ repo: "o/r", number: 7, add: ["yu1sh", "4rtofl/ui"], remove: ["4rna-y"] }, ctx);
  await assert.rejects(changeReviewers.run({ repo: "o/r", number: 7, add: ["--repo=x/y"] }, ctx));
  await assert.rejects(changeReviewers.run({ repo: "o/r", number: 7, add: ["a/b/c"] }, ctx));
  await assert.rejects(changeReviewers.run({ repo: "o/r", number: 7 }, ctx));
  assert.deepEqual(writes, [["pr", "edit", "7", "--repo", "o/r", "--add-reviewer=yu1sh", "--add-reviewer=4rtofl/ui", "--remove-reviewer=4rna-y"]]);
});
