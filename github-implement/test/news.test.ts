import assert from "node:assert/strict";
import { test } from "node:test";
import checksFinished from "../src/daemon/detail/checks-finished.ts";
import type { GitHubItemDetail } from "../src/types.ts";
import { laterMarks, marksOf, newsOf } from "../src/news.ts";

const item = (over: Partial<GitHubItemDetail>): GitHubItemDetail => ({ kind: "pulls", number: 1, title: "t", url: "https://github.com/o/r/pull/1", createdAt: "", updatedAt: "", labels: [], state: "open", assignees: [], body: "", ...over });
const comment = (createdAt: string) => ({ createdAt, body: "" });

test("a check counts as finished once it has a result, at the time it got it", () => {
  const read = item({});
  checksFinished.read(
    {
      statusCheckRollup: [
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE", completedAt: "2026-11-15T10:05:00Z" },
        // Running: gh gives the zero time as its end.
        { __typename: "CheckRun", status: "IN_PROGRESS", completedAt: "0001-01-01T00:00:00Z" },
        { __typename: "StatusContext", state: "SUCCESS", startedAt: "2026-11-15T10:01:00Z" },
        { __typename: "StatusContext", state: "PENDING", startedAt: "2026-11-15T10:02:00Z" },
      ],
    },
    read,
  );
  assert.deepEqual(read.checksFinishedAt, ["2026-11-15T10:05:00Z", "2026-11-15T10:01:00Z"]);
});

test("what came after the marks is new, and a kind that had none when seen is new whole", () => {
  const before = item({ comments: [comment("2026-11-15T10:00:00Z")], reviews: [], checksFinishedAt: [] });
  const seen = marksOf(before);
  assert.deepEqual(seen, { comment: "2026-11-15T10:00:00Z" });

  const now = item({
    comments: [comment("2026-11-15T10:00:00Z"), comment("2026-11-15T10:30:00Z"), comment("2026-11-15T11:00:00Z")],
    reviews: [{ submittedAt: "2026-11-15T10:10:00Z", state: "approved", body: "" }],
    checksFinishedAt: ["2026-11-15T10:20:00Z"],
  });
  assert.deepEqual(newsOf(now, seen), { comments: 2, reviews: 1, checks: 1 });
  // Opening the tab again sees all of it.
  assert.deepEqual(newsOf(now, marksOf(now)), { comments: 0, reviews: 0, checks: 0 });
});

test("a mark never goes back: a screen that read the item before tells it after", () => {
  const newer = { comment: "2026-11-15T11:00:00Z", check: "2026-11-15T10:20:00Z" };
  const older = { comment: "2026-11-15T10:00:00Z", review: "2026-11-15T09:00:00Z" };
  assert.deepEqual(laterMarks(newer, older), { comment: "2026-11-15T11:00:00Z", review: "2026-11-15T09:00:00Z", check: "2026-11-15T10:20:00Z" });
  // What a file or a browser holds that is not a time is no mark.
  assert.deepEqual(laterMarks({ comment: 123 as unknown as string, review: "soon" }, {}), {});
});
