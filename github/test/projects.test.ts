import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BOARD_PAGES, listProjects, parseBoardPage, parseProjects, PROJECTS_MAX, readBoard } from "../src/daemon/projects.ts";

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
      updatedAt: "2026-11-17T17:40:27Z",
      items: 648,
    },
  ]);
  // The linked one is not listed again among the owner's.
  assert.equal(p.owner.length, 14);
  assert.ok(!p.owner.some((x) => x.number === 4247));
  // Read by the organization's old login (4rtoflow), as a clone's origin may still say it: the owner is the one now.
  assert.deepEqual(parseProjects(fixture("projects-empty.json")), { linked: [], owner: [], ownerLogin: "4rtofl" });
});

test("open projects and closed ones are read apart, open ones first; more than were read says so", () => {
  const ref = (number: number, closed: boolean) => ({ number, title: `P${number}`, url: `https://github.com/orgs/o/projects/${number}`, closed, items: { totalCount: 0 } });
  const open = Array.from({ length: PROJECTS_MAX }, (_, i) => ref(i + 10, false));
  const json = JSON.stringify({
    data: {
      repository: {
        open: { totalCount: 0, nodes: [] },
        closed: { totalCount: 1, nodes: [ref(1, true)] },
        owner: { login: "o", open: { totalCount: PROJECTS_MAX + 3, nodes: open }, closed: { totalCount: 2, nodes: [ref(2, true), ref(1, true)] } },
      },
    },
  });
  const p = parseProjects(json);
  assert.deepEqual(p.linked.map((x) => x.number), [1]);
  assert.equal(p.linkedTruncated, undefined);
  assert.equal(p.owner.length, PROJECTS_MAX + 1);
  assert.deepEqual([p.owner[0]?.closed, p.owner.at(-1)?.number], [false, 2]);
  assert.equal(p.ownerTruncated, true);
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
  // Asked by a name GitHub has since changed, the answer names the repository as it is now: its items are its own.
  assert.equal(parseBoardPage(fixture("board-page.json"), "old-owner/roadmap")?.board.items[0]?.repo, undefined);
  // The same items seen from another repository name theirs.
  const elsewhere = JSON.parse(fixture("board-page.json")) as { data: { repository: { nameWithOwner: string } } };
  elsewhere.data.repository.nameWithOwner = "o/r";
  assert.equal(parseBoardPage(JSON.stringify(elsewhere), "o/r")?.board.items[0]?.repo, "github/roadmap");
  assert.equal(parseBoardPage(JSON.stringify({ data: { repository: { nameWithOwner: "o/r", owner: { projectV2: null } } } }), "o/r"), undefined);
});

test("items: drafts, pull requests' states, archived and unreadable ones", () => {
  const item = (content: unknown, extra: Record<string, unknown> = {}) => ({ id: `I${Math.random()}`, type: "X", isArchived: false, content, fieldValues: { nodes: [] }, ...extra });
  const json = JSON.stringify({
    data: {
      repository: {
        owner: {
          projectV2: {
            number: 1,
            title: "P",
            url: "https://github.com/orgs/o/projects/1",
            closed: false,
            fields: {
              nodes: [
                { __typename: "ProjectV2Field" },
                { __typename: "ProjectV2SingleSelectField", id: "F", name: "Stage", options: [{ id: "a", name: "A" }] },
                {
                  __typename: "ProjectV2IterationField",
                  id: "IT",
                  name: "Iteration",
                  configuration: {
                    iterations: [{ id: "i5", title: "Iteration 5", startDate: "2026-11-20" }, { id: "i4", title: "Iteration 4", startDate: "2026-11-06" }],
                    // GitHub gives the ended ones newest first.
                    completedIterations: [{ id: "i3", title: "Iteration 3", startDate: "2026-10-23" }, { id: "i2", title: "Iteration 2", startDate: "2026-10-09" }],
                  },
                },
              ],
            },
            views: { nodes: [] },
            items: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                item({ __typename: "DraftIssue", title: "memo", assignees: { nodes: [{ login: "ama" }] } }),
                item({ __typename: "PullRequest", number: 2, title: "pr", url: "https://github.com/o/r/pull/2", state: "OPEN", isDraft: true, repository: { nameWithOwner: "o/r" } }),
                item({ __typename: "PullRequest", number: 3, title: "pr", url: "https://github.com/o/r/pull/3", state: "MERGED", repository: { nameWithOwner: "o/r" } }),
                item({ __typename: "Issue", number: 4, title: "i", url: "https://github.com/o/r/issues/4", state: "CLOSED", stateReason: "NOT_PLANNED", repository: { nameWithOwner: "o/r" } }),
                item(
                  { __typename: "Issue", number: 5, title: "d", url: "https://github.com/o/r/issues/5", state: "CLOSED", stateReason: "DUPLICATE", repository: { nameWithOwner: "o/r" } },
                  { fieldValues: { nodes: [{ __typename: "ProjectV2ItemFieldIterationValue", iterationId: "i4", field: { id: "IT" } }] } },
                ),
                item(null),
                item({ __typename: "Issue", title: "old" }, { isArchived: true }),
              ],
            },
          },
        },
      },
    },
  });
  const board = parseBoardPage(json, "O/R")?.board;
  assert.ok(board);
  // Without a board view, "Status", else the first single select field.
  assert.equal(board.defaultField, "F");
  // An iteration field's columns: the iterations that ended, then the others, by their start.
  assert.deepEqual(
    board.fields[1]?.options.map((o) => [o.id, o.completed ?? false]),
    [
      ["i2", true],
      ["i3", true],
      ["i4", false],
      ["i5", false],
    ],
  );
  assert.deepEqual(board.items.find((i) => i.number === 5)?.values, { IT: "i4" });
  // A board view that makes its columns of the iteration field.
  const viewed = JSON.parse(json) as { data: { repository: { owner: { projectV2: { views: unknown } } } } };
  viewed.data.repository.owner.projectV2.views = { nodes: [{ layout: "TABLE_LAYOUT", verticalGroupByFields: { nodes: [] } }, { layout: "BOARD_LAYOUT", verticalGroupByFields: { nodes: [{ id: "IT" }] } }] };
  assert.equal(parseBoardPage(JSON.stringify(viewed), "O/R")?.board.defaultField, "IT");
  assert.deepEqual(
    board.items.map((i) => [i.type, i.state, i.title, i.assignees]),
    [
      ["draft", undefined, "memo", ["ama"]],
      ["pull", "draft", "pr", []],
      ["pull", "merged", "pr", []],
      ["issue", "not_planned", "i", []],
      ["issue", "duplicate", "d", []],
      ["redacted", undefined, "（読めない項目）", []],
    ],
  );
});

test("a board is read page by page, up to its limit", async () => {
  const pages: (string | undefined)[] = [];
  const names = new Set<string | undefined>();
  const ctx = {
    github: {
      read: async (args: string[]) => {
        pages.push(args.find((a) => a.startsWith("cursor="))?.slice(7));
        names.add(args.find((a) => a.startsWith("name="))?.slice(5));
        return { stdout: fixture("board-page.json"), stderr: "" };
      },
    },
  };
  const board = await readBoard(ctx as never, "github/roadmap", 4247, { maxAgeSeconds: 30 });
  assert.equal(pages.length, BOARD_PAGES);
  assert.equal(pages[0], undefined);
  assert.equal(board?.items.length, 6 * BOARD_PAGES);
  assert.equal(board?.truncated, true);
  // The project is found through the repository, so that an owner's old login still leads to it.
  assert.deepEqual([...names], ["roadmap"]);
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
