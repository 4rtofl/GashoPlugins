import assert from "node:assert/strict";
import { test } from "node:test";
import { assignableQueryArgs, parseAssignable } from "../src/daemon/ops/assignable.ts";
import { createLabelArgs, newLabelArg } from "../src/daemon/ops/create-label.ts";
import { labelsQueryArgs, parseLabels } from "../src/daemon/ops/labels.ts";

test("a new label is one that edit can put on, and its name never becomes a flag of gh", () => {
  // gh edit --add-label splits names at ",": a label made with one could never be put on from the screen.
  assert.throws(() => newLabelArg({ name: "a,b", color: "1d76db" }));
  assert.throws(() => newLabelArg({ name: "  ", color: "1d76db" }));
  assert.throws(() => newLabelArg({ name: "a", color: "#1d76db" }));
  const label = newLabelArg({ name: " --repo x/y ", color: "1D76DB", description: "" });
  assert.deepEqual(label, { name: "--repo x/y", color: "1d76db" });
  assert.deepEqual(createLabelArgs("o/r", label), ["api", "--method", "POST", "repos/o/r/labels", "-f", "name=--repo x/y", "-f", "color=1d76db"]);
});

test("the lookups of labels and people send what is typed as a variable apart from the query, and tell when there are more", () => {
  for (const args of [labelsQueryArgs("o/r", "bug"), assignableQueryArgs("o/r", "bug")]) {
    // gh api graphql takes the field "query" as the query itself: a variable of that name would replace it.
    assert.deepEqual(
      args.filter((a) => a.startsWith("query=")),
      [args[args.indexOf("-f") + 1]],
    );
    assert.ok(args.includes("filter=bug"));
  }
  assert.deepEqual(parseLabels(JSON.stringify({ data: { repository: { labels: { totalCount: 51, nodes: [{ name: "bug", color: "d73a4a" }] } } } })), { labels: [{ name: "bug", color: "d73a4a" }], more: true });
  assert.deepEqual(parseAssignable(JSON.stringify({ data: { repository: { assignableUsers: { totalCount: 1, nodes: [{ login: "4rna-y" }] } } } })), { logins: ["4rna-y"], more: false });
});
