import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ctx } from "../src/daemon/core.ts";
import { COMMENTS_MAX } from "../src/daemon/detail/comments.ts";
import { commentEditArgs } from "../src/daemon/ops/comment-edit.ts";
import { parseComments, readComments } from "../src/daemon/ops/comments.ts";

const groups = (given: Record<string, [number, boolean]>) =>
  ["THUMBS_UP", "THUMBS_DOWN", "LAUGH", "HOORAY", "CONFUSED", "HEART", "ROCKET", "EYES"].map((content) => ({
    content,
    viewerHasReacted: given[content]?.[1] ?? false,
    reactors: { totalCount: given[content]?.[0] ?? 0 },
  }));

const page = (ids: number[], before?: string) =>
  JSON.stringify({
    data: {
      repository: {
        issueOrPullRequest: {
          id: "I_kwDOxx",
          reactionGroups: groups({ EYES: [1, false], THUMBS_UP: [2, true] }),
          comments: {
            pageInfo: { hasPreviousPage: before !== undefined, startCursor: before ?? null },
            nodes: ids.map((n) => ({
              id: `IC_${n}`,
              url: `https://github.com/o/r/issues/1#issuecomment-${n}`,
              author: { __typename: n === 2 ? "Bot" : "User" },
              viewerDidAuthor: n === 1 || n === 3,
              viewerCanUpdate: n !== 3,
              viewerCanDelete: true,
              reactionGroups: groups({}),
            })),
          },
        },
      },
    },
  });

test("the comments' read tells bots, gh's own comments it may change, and the reactions given, in GitHub's order", () => {
  const read = parseComments(page([1, 2, 3]));
  assert.ok(read && !read.before);
  assert.deepEqual(read.meta.reactions, [
    { content: "THUMBS_UP", count: 2, mine: true },
    { content: "EYES", count: 1, mine: false },
  ]);
  assert.deepEqual(
    read.meta.comments.map((c) => [c.id, c.bot, c.editable, c.deletable, c.reactions.length]),
    [
      ["IC_1", false, true, true, 0],
      ["IC_2", true, false, false, 0],
      // Its own comment that GitHub does not let it change now (a locked conversation).
      ["IC_3", false, false, true, 0],
    ],
  );
});

test("older pages are read until there are as many comments as the item's read keeps, oldest first", async () => {
  const asked: (string | undefined)[] = [];
  const pages = new Map<string | undefined, string>([
    [undefined, page([201, 202], "c2")],
    ["c2", page([101, 102], "c1")],
    ["c1", page([1, 2])],
  ]);
  const ctx = {
    github: {
      read: async (args: string[]) => {
        const before = args.find((a) => a.startsWith("before="))?.slice("before=".length);
        asked.push(before);
        return { stdout: pages.get(before) ?? "", stderr: "" };
      },
    },
    log: () => undefined,
  } as unknown as Ctx;
  const meta = await readComments(ctx, "o/r", 1, 0);
  assert.deepEqual(asked, [undefined, "c2", "c1"]);
  assert.deepEqual(
    meta.comments.map((c) => c.id),
    ["IC_1", "IC_2", "IC_101", "IC_102", "IC_201", "IC_202"],
  );

  // A page holds 100: the item's read keeps COMMENTS_MAX, so no more pages than that are read.
  const full = (from: number) => Array.from({ length: 100 }, (_, i) => from + i);
  let reads = 0;
  const many = {
    github: { read: async () => (reads++, { stdout: page(full(reads * 100), "more"), stderr: "" }) },
    log: () => undefined,
  } as unknown as Ctx;
  assert.equal((await readComments(many, "o/r", 1, 0)).comments.length, COMMENTS_MAX);
  assert.equal(reads, COMMENTS_MAX / 100);
});

test("a comment's new text goes to gh as a raw field, never read from a file", () => {
  // gh api reads the file of a -F value that starts with "@".
  const args = commentEditArgs("IC_1", "@/etc/passwd");
  assert.equal(args[args.indexOf("body=@/etc/passwd") - 1], "-f");
  assert.equal(args[args.indexOf("id=IC_1") - 1], "-f");
});
