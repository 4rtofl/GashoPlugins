import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BOARD_PAGES, listProjects, parseBoardPage, parseProjects, readBoard } from "../src/daemon/projects.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

test("the repository's projects and its owner's others are read (real output)", () => {
  const p = parseProjects(fixture("projects-roadmap.json"));
  assert.equal(p.ownerLogin, "github");
  assert.deepEqual(p.linked, [
    {
      number: 4247,
      title: "GitHub Public Roadmap",
      url: "https://github.com/orgs/github/projects/4247",
      closed: false,
      shortDescription: "The official GitHub product roadmap!",
      updatedAt: "2026-11-13T20:16:04Z",
      items: 648,
    },
  ]);
  // The linked one is not listed again among the owner's.
  assert.equal(p.owner.length, 14);
  assert.ok(!p.owner.some((x) => x.number === 4247));
  assert.deepEqual(parseProjects(fixture("projects-empty.json")), { linked: [], owner: [], ownerLogin: "4rtoflow" });
});

test("a board is read: its single select fields, the field its board view uses, and its items (real output)", () => {
  const page = parseBoardPage(fixture("board-page.json"), "github/roadmap");
  assert.ok(page);
  const { board, next } = page;
  assert.equal(board.title, "GitHub Public Roadmap");
  assert.deepEqual(
    board.fields.map((f) => [f.name, f.options.length]),
    [
      ["Status", 4],
      ["Product Focus Area", 3],
      ["Release Phase", 2],
      ["Theme", 3],
      ["Quarter", 7],
    ],
  );
  assert.equal(board.defaultField, board.fields[0]?.id);
  assert.ok(board.fields[0]?.options.every((o) => o.color));
  assert.equal(board.items.length, 6);
  const [first, second] = board.items;
  assert.equal(first?.type, "issue");
  assert.equal(first?.state, "open");
  assert.equal(first?.number, 1093);
  assert.equal(first?.repo, undefined);
  assert.equal(second?.state, "closed");
  const status = board.fields[0];
  assert.ok(status && first && status.options.some((o) => o.id === first.values[status.id]));
  assert.ok(next);
  // The same items seen from another repository name theirs.
  assert.equal(parseBoardPage(fixture("board-page.json"), "o/r")?.board.items[0]?.repo, "github/roadmap");
  assert.equal(parseBoardPage(JSON.stringify({ data: { repositoryOwner: { projectV2: null } } }), "o/r"), undefined);
});

test("items: drafts, pull requests' states, archived and unreadable ones", () => {
  const item = (content: unknown, extra: Record<string, unknown> = {}) => ({ id: `I${Math.random()}`, type: "X", isArchived: false, content, fieldValues: { nodes: [] }, ...extra });
  const json = JSON.stringify({
    data: {
      repositoryOwner: {
        projectV2: {
          number: 1,
          title: "P",
          url: "https://github.com/orgs/o/projects/1",
          closed: false,
          fields: { nodes: [{ __typename: "ProjectV2Field" }, { __typename: "ProjectV2SingleSelectField", id: "F", name: "Stage", options: [{ id: "a", name: "A" }] }] },
          views: { nodes: [] },
          items: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              item({ __typename: "DraftIssue", title: "memo", assignees: { nodes: [{ login: "ama" }] } }),
              item({ __typename: "PullRequest", number: 2, title: "pr", url: "https://github.com/o/r/pull/2", state: "OPEN", isDraft: true, repository: { nameWithOwner: "o/r" } }),
              item({ __typename: "PullRequest", number: 3, title: "pr", url: "https://github.com/o/r/pull/3", state: "MERGED", repository: { nameWithOwner: "o/r" } }),
              item({ __typename: "Issue", number: 4, title: "i", url: "https://github.com/o/r/issues/4", state: "CLOSED", stateReason: "NOT_PLANNED", repository: { nameWithOwner: "o/r" } }),
              item(null),
              item({ __typename: "Issue", title: "old" }, { isArchived: true }),
            ],
          },
        },
      },
    },
  });
  const board = parseBoardPage(json, "O/R")?.board;
  assert.ok(board);
  // Without a board view, "Status", else the first single select field.
  assert.equal(board.defaultField, "F");
  assert.deepEqual(
    board.items.map((i) => [i.type, i.state, i.title, i.assignees]),
    [
      ["draft", undefined, "memo", ["ama"]],
      ["pull", "draft", "pr", []],
      ["pull", "merged", "pr", []],
      ["issue", "not_planned", "i", []],
      ["redacted", undefined, "（読めない項目）", []],
    ],
  );
});

test("a board is read page by page, up to its limit", async () => {
  const pages: (string | undefined)[] = [];
  const ctx = {
    github: {
      read: async (args: string[]) => {
        pages.push(args.find((a) => a.startsWith("cursor="))?.slice(7));
        return { stdout: fixture("board-page.json"), stderr: "" };
      },
    },
  };
  const board = await readBoard(ctx as never, "github/roadmap", 4247, { maxAgeSeconds: 30 });
  assert.equal(pages.length, BOARD_PAGES);
  assert.equal(pages[0], undefined);
  assert.equal(board?.items.length, 6 * BOARD_PAGES);
  assert.equal(board?.truncated, true);
});

test("without read:project, the answer says how to add it", async () => {
  const message =
    "Your token has not been granted the required scopes to execute this query. The 'projectsV2' field requires one of the following scopes: ['read:project'], but your token has only been granted the: ['gist', 'read:org', 'repo', 'workflow'] scopes.";
  // gh prints GraphQL's errors and exits non-zero.
  const failing = { github: { read: async () => Promise.reject(Object.assign(new Error("exit 1"), { stderr: `gh: ${message}`, stdout: "" })) } };
  const p = await listProjects(failing as never, "o/r", { maxAgeSeconds: 60 });
  assert.deepEqual(p.missing, { scope: "read:project", command: "gh auth refresh -h github.com -s read:project" });
  // An answer that holds the error.
  const answering = { github: { read: async () => ({ stdout: JSON.stringify({ data: { repository: null }, errors: [{ type: "INSUFFICIENT_SCOPES", message }] }), stderr: "" }) } };
  assert.equal((await readBoard(answering as never, "o/r", 1, { maxAgeSeconds: 30 }))?.missing?.scope, "read:project");
  const other = { github: { read: async () => Promise.reject(Object.assign(new Error("x"), { stderr: "HTTP 502" })) } };
  await assert.rejects(listProjects(other as never, "o/r", { maxAgeSeconds: 60 }));
});
