import assert from "node:assert/strict";
import { test } from "node:test";
import { eventsQueryArgs, parseEvents } from "../src/daemon/ops/events.ts";

test("only a pull request's part of the events query asks for merges", () => {
  const args = eventsQueryArgs("4rtofl/GashoPlugins", 9);
  const query = args[args.indexOf("-f") + 1] ?? "";
  // GitHub refuses the whole query when an issue's timeline items spread MergedEvent.
  const issuePart = query.slice(query.indexOf("... on Issue"), query.indexOf("... on PullRequest"));
  assert.doesNotMatch(issuePart, /MergedEvent|MERGED_EVENT/);
  assert.match(query.slice(query.indexOf("... on PullRequest")), /MERGED_EVENT.*\.\.\. on MergedEvent/);
  assert.ok(args.includes("number=9"));
});

test("events become the conversation's changes, and a merge hides the close it comes with", () => {
  const json = JSON.stringify({
    data: {
      repository: {
        issueOrPullRequest: {
          timelineItems: {
            nodes: [
              { __typename: "LabeledEvent", createdAt: "2026-11-14T17:26:23Z", actor: { login: "totosuki" }, label: { name: "documentation", color: "0075ca" } },
              { __typename: "AssignedEvent", createdAt: "2026-11-14T17:26:30Z", actor: { login: "totosuki" }, assignee: { login: "4rna-y" } },
              { __typename: "ClosedEvent", createdAt: "2026-11-14T17:27:21Z", actor: { login: "totosuki" }, stateReason: "NOT_PLANNED" },
              { __typename: "MergedEvent", createdAt: "2026-11-14T18:20:42Z", actor: { login: "4rna-y" } },
              { __typename: "ClosedEvent", createdAt: "2026-11-14T18:20:42Z", actor: { login: "4rna-y" } },
              { __typename: "LabeledEvent", createdAt: "2026-11-14T18:30:00Z", label: null },
            ],
          },
        },
      },
    },
  });
  assert.deepEqual(parseEvents(json), [
    { type: "labeled", at: "2026-11-14T17:26:23Z", actor: "totosuki", label: { name: "documentation", color: "0075ca" } },
    { type: "assigned", at: "2026-11-14T17:26:30Z", actor: "totosuki", assignee: "4rna-y" },
    { type: "closed", at: "2026-11-14T17:27:21Z", actor: "totosuki", stateReason: "not_planned" },
    { type: "merged", at: "2026-11-14T18:20:42Z", actor: "4rna-y" },
  ]);
});

test("a merge hides the close it comes with a second apart, and a close that was reopened stays", () => {
  const node = (__typename: string, createdAt: string, more: Record<string, unknown> = {}) => ({ __typename, createdAt, actor: { login: "4rna-y" }, ...more });
  const json = (nodes: unknown[]) => JSON.stringify({ data: { repository: { issueOrPullRequest: { timelineItems: { nodes } } } } });
  const merged = parseEvents(json([node("ClosedEvent", "2026-11-14T10:00:00Z"), node("ReopenedEvent", "2026-11-14T10:05:00Z"), node("ClosedEvent", "2026-11-14T18:20:41Z"), node("MergedEvent", "2026-11-14T18:20:42Z")]));
  assert.deepEqual(
    merged.map((e) => `${e.type} ${e.at}`),
    ["closed 2026-11-14T10:00:00Z", "reopened 2026-11-14T10:05:00Z", "merged 2026-11-14T18:20:42Z"],
  );
  assert.deepEqual(
    parseEvents(json([node("MergedEvent", "2026-11-14T18:20:42Z"), node("ClosedEvent", "2026-11-14T18:20:43Z")])).map((e) => e.type),
    ["merged"],
  );
  // An issue closed as a duplicate says so.
  assert.equal(parseEvents(json([node("ClosedEvent", "2026-11-14T10:00:00Z", { stateReason: "DUPLICATE" })]))[0]?.stateReason, "duplicate");
});
