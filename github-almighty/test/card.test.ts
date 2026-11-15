import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCard } from "../src/daemon/ops/card.ts";

const answer = (item: Record<string, unknown> | null, me = "me") => JSON.stringify({ data: { viewer: { login: me }, repository: { issueOrPullRequest: item } } });

const issue = {
  __typename: "Issue",
  number: 28,
  title: "t",
  state: "CLOSED",
  stateReason: "NOT_PLANNED",
  url: "https://github.com/o/r/issues/28",
  createdAt: "2026-11-14T18:15:36Z",
  bodyText: "first line\n\n  second\tline",
  viewerDidAuthor: false,
  labels: { nodes: [{ name: "bug", color: "d73a4a" }, { name: "odd", color: "red" }] },
  assignees: { nodes: [{ login: "someone" }, { login: "me" }] },
  comments: { nodes: [{ viewerDidAuthor: false }, { viewerDidAuthor: true }] },
};

test("a card says how gh's login is related to the item: by its login for assignees, by GitHub for the rest", () => {
  const card = parseCard(answer(issue));
  assert.deepEqual(
    { assigned: card?.assigned, authored: card?.authored, commented: card?.commented, stateReason: card?.stateReason, labels: card?.labels },
    { assigned: true, authored: false, commented: true, stateReason: "not_planned", labels: [{ name: "bug", color: "d73a4a" }, { name: "odd" }] },
  );
  const other = parseCard(answer({ ...issue, viewerDidAuthor: true, comments: { nodes: [] } }, "nobody"));
  assert.deepEqual([other?.assigned, other?.authored, other?.commented], [false, true, false]);
});

test("the start of the body is one line, cut by characters, not by the halves of an emoji", () => {
  assert.equal(parseCard(answer(issue))?.excerpt, "first line second line");
  const long = parseCard(answer({ ...issue, bodyText: "😀".repeat(400) }))?.excerpt ?? "";
  assert.equal(long, `${"😀".repeat(300)}…`);
  assert.equal(parseCard(answer({ ...issue, bodyText: "" }))?.excerpt, "");
});

test("a number GitHub does not have is no card", () => {
  assert.equal(parseCard(answer(null)), null);
});
