import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import type { DaemonContext } from "@gasho/plugin-sdk/daemon";
import type { Ctx } from "../src/daemon/core.ts";
import { COMMENTS_MAX } from "../src/daemon/detail/comments.ts";
import commentEdit from "../src/daemon/ops/comment-edit.ts";
import comment from "../src/daemon/ops/comment.ts";
import { parseComments, readComments } from "../src/daemon/ops/comments.ts";

const groups = (given: Record<string, [number, boolean, string[]?]>) =>
  ["THUMBS_UP", "THUMBS_DOWN", "LAUGH", "HOORAY", "CONFUSED", "HEART", "ROCKET", "EYES"].map((content) => ({
    content,
    viewerHasReacted: given[content]?.[1] ?? false,
    reactors: { totalCount: given[content]?.[0] ?? 0, nodes: (given[content]?.[2] ?? []).map((login) => ({ login })) },
  }));

const named = Array.from({ length: 10 }, (_, i) => `u${i}`);

const page = (ids: number[], before?: string) =>
  JSON.stringify({
    data: {
      repository: {
        issueOrPullRequest: {
          id: "I_kwDOxx",
          reactionGroups: groups({ EYES: [1, false, ["hubot"]], THUMBS_UP: [12, true, named] }),
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
          reviews: { nodes: [{ id: "PRR_1", reactionGroups: groups({ HEART: [1, false, ["4rna-y"]] }) }] },
        },
      },
    },
  });

test("the comments' read tells bots, gh's own comments it may change, and the reactions given and who gave them, in GitHub's order", () => {
  const read = parseComments(page([1, 2, 3]));
  assert.ok(read && !read.before);
  assert.deepEqual(read.meta.reactions, [
    // GitHub names the first 10 of the 12.
    { content: "THUMBS_UP", count: 12, users: named, mine: true },
    { content: "EYES", count: 1, users: ["hubot"], mine: false },
  ]);
  assert.deepEqual(read.meta.reviews, [{ id: "PRR_1", reactions: [{ content: "HEART", count: 1, users: ["4rna-y"], mine: false }] }]);
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

test("older pages are read until there are as many comments as the item's read keeps, oldest first; a pull request's reviews only with the first", async () => {
  const asked: [string | undefined, string | undefined][] = [];
  const pages = new Map<string | undefined, string>([
    [undefined, page([201, 202], "c2")],
    ["c2", page([101, 102], "c1")],
    ["c1", page([1, 2])],
  ]);
  const ctx = {
    github: {
      read: async (args: string[]) => {
        const before = args.find((a) => a.startsWith("before="))?.slice("before=".length);
        asked.push([before, args.find((a) => a.startsWith("reviews="))]);
        return { stdout: pages.get(before) ?? "", stderr: "" };
      },
    },
    log: () => undefined,
  } as unknown as Ctx;
  const meta = await readComments(ctx, "o/r", 1, {}, true);
  assert.deepEqual(asked, [
    [undefined, "reviews=true"],
    ["c2", "reviews=false"],
    ["c1", "reviews=false"],
  ]);
  assert.deepEqual(
    meta.comments.map((c) => c.id),
    ["IC_1", "IC_2", "IC_101", "IC_102", "IC_201", "IC_202"],
  );
  assert.deepEqual(
    meta.reviews.map((r) => r.id),
    ["PRR_1"],
  );
  // An issue has no reviews, and asking for them would cost a point.
  asked.length = 0;
  await readComments(ctx, "o/r", 1, {});
  assert.ok(asked.every(([, reviews]) => reviews === "reviews=false"));

  // A page holds 100: the item's read keeps COMMENTS_MAX, so no more pages than that are read.
  const full = (from: number) => Array.from({ length: 100 }, (_, i) => from + i);
  let reads = 0;
  const many = {
    github: { read: async () => (reads++, { stdout: page(full(reads * 100), "more"), stderr: "" }) },
    log: () => undefined,
  } as unknown as Ctx;
  assert.equal((await readComments(many, "o/r", 1, {})).comments.length, COMMENTS_MAX);
  assert.equal(reads, COMMENTS_MAX / 100);
});

test("a long comment reaches gh in a file of its own, which goes after: Linux takes 128 KiB at most per argument", async () => {
  // 3 bytes a character: past 128 KiB. A text that starts with "@" is only what the file holds.
  const body = `@/etc/passwd\n${"あ".repeat(50_000)}`;
  const sent: { args: string[]; text: string }[] = [];
  const ctx = {
    github: {
      write: async (args: string[]) => {
        const file = args.find((a) => a.startsWith("--body-file="))?.slice("--body-file=".length) ?? args.find((a) => a.startsWith("body=@"))?.slice("body=@".length) ?? "";
        sent.push({ args, text: await fs.readFile(file, "utf8") });
        return { stdout: "", stderr: "" };
      },
    },
    log: () => undefined,
  } as unknown as DaemonContext;
  await comment.run({ repo: "o/r", kind: "issues", number: 3, body }, ctx);
  await commentEdit.run({ repo: "o/r", id: "IC_1", body }, ctx);
  assert.deepEqual(
    sent.map((s) => s.text === body),
    [true, true],
  );
  assert.ok(sent.every((s) => s.args.every((a) => Buffer.byteLength(a) < 1024)));
  // gh api reads the file of a -F value that starts with "@"; the id stays a raw field.
  const edit = sent[1]?.args ?? [];
  assert.equal(edit[edit.findIndex((a) => a.startsWith("body=@")) - 1], "-F");
  assert.equal(edit[edit.indexOf("id=IC_1") - 1], "-f");
  for (const s of sent) {
    const file = (s.args.find((a) => a.startsWith("--body-file=")) ?? s.args.find((a) => a.startsWith("body=@")) ?? "").replace(/^--body-file=|^body=@/, "");
    await assert.rejects(fs.stat(file));
  }
});
