import assert from "node:assert/strict";
import { test } from "node:test";
import { createLabelArgs, newLabelArg } from "../src/daemon/ops/create-label.ts";

test("a new label is one that edit can put on, and its name never becomes a flag of gh", () => {
  // gh edit --add-label splits names at ",": a label made with one could never be put on from the screen.
  assert.throws(() => newLabelArg({ name: "a,b", color: "1d76db" }));
  assert.throws(() => newLabelArg({ name: "  ", color: "1d76db" }));
  assert.throws(() => newLabelArg({ name: "a", color: "#1d76db" }));
  const label = newLabelArg({ name: " --repo x/y ", color: "1D76DB", description: "" });
  assert.deepEqual(label, { name: "--repo x/y", color: "1d76db" });
  assert.deepEqual(createLabelArgs("o/r", label), ["api", "--method", "POST", "repos/o/r/labels", "-f", "name=--repo x/y", "-f", "color=1d76db"]);
});
