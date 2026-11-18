import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStack, stackQueryArgs } from "../src/daemon/ops/stack.ts";

const pr = (number: number, head: string, base: string, state = "OPEN", more: Record<string, unknown> = {}) => ({
  number,
  title: `t${number}`,
  state,
  isDraft: false,
  url: `https://github.com/o/r/pull/${number}`,
  headRefName: head,
  baseRefName: base,
  isCrossRepository: false,
  ...more,
});
/** A parent's base branch: null when it was deleted, else the pull requests whose head it is. */
const ref = (name: string, ...pulls: unknown[]) => ({ baseRef: { name, associatedPullRequests: { nodes: pulls } } });
const answer = (repository: Record<string, unknown>) => JSON.stringify({ data: { repository: { defaultBranchRef: { name: "main" }, children: { nodes: [] }, ...repository } } });
const numbers = (pulls: { number: number }[]) => pulls.map((p) => p.number);

test("the parents go from the default branch to this one, an open one before a merged one, and the children follow", () => {
  const json = answer({
    pullRequest: { isCrossRepository: false },
    baseRef: { name: "b", compare: { behindBy: 2 } },
    // b had a merged pull request before the open one; a fork's branch of the same name is not a parent.
    parent: {
      nodes: [
        pr(9, "b", "x", "OPEN", { isCrossRepository: true, ...ref("x") }),
        pr(5, "b", "a", "MERGED", ref("a")),
        pr(2, "b", "a", "OPEN", ref("a", pr(1, "a", "main", "OPEN", ref("main")))),
        pr(6, "b", "a", "CLOSED", ref("a")),
      ],
    },
    children: { nodes: [pr(4, "c", "c2"), pr(7, "c", "c3")] },
  });
  const s = parseStack(json, 3, "b");
  assert.deepEqual(numbers(s.parents), [1, 2]);
  assert.deepEqual(s.root, { name: "main" });
  assert.deepEqual(numbers(s.children), [4, 7]);
  assert.deepEqual(s.base, { name: "b", behindBy: 2 });
  assert.equal(s.mergedInto, undefined);

  // Branch names go to GitHub as variables, never into the query's text.
  const args = stackQueryArgs("o/r", 3, 'c" } }', "b");
  assert.ok(args.includes('head=c" } }') && args.includes("base=b") && args.includes("baseRef=refs/heads/b") && args.includes("number=3"));
  assert.doesNotMatch(args[args.indexOf("-f") + 1] ?? "", /c" \} \}/);
});

test("a merged parent whose branch was deleted shows the base as gone, and where the parent went", () => {
  const json = answer({
    pullRequest: { isCrossRepository: false },
    baseRef: null,
    parent: { nodes: [pr(2, "b", "a", "MERGED", ref("a", pr(1, "a", "main", "OPEN", ref("main"))))] },
  });
  const s = parseStack(json, 3, "b");
  assert.deepEqual(s.base, { name: "b", gone: true });
  assert.deepEqual(numbers(s.parents), [1, 2]);
  // #2 went into a, the head of #1 that is still open.
  assert.equal(s.mergedInto, "a");

  // Every parent merged: the root, unless its branch was deleted too.
  const all = (rootRef: unknown) =>
    parseStack(answer({ baseRef: null, parent: { nodes: [pr(2, "b", "a", "MERGED", { baseRef: { name: "a", associatedPullRequests: { nodes: [pr(1, "a", "x", "MERGED", { baseRef: rootRef })] } } })] } }), 3, "b");
  assert.equal(all({ name: "x", associatedPullRequests: { nodes: [] } }).mergedInto, "x");
  assert.deepEqual(all(null).root, { name: "x", gone: true });
  assert.equal(all(null).mergedInto, undefined);
});

test("pull requests based on each other end the parents instead of going round", () => {
  const json = answer({ baseRef: { name: "b", compare: { behindBy: 0 } }, parent: { nodes: [pr(2, "b", "a", "OPEN", ref("a", pr(1, "a", "b", "OPEN", ref("b"))))] } });
  const s = parseStack(json, 1, "b");
  assert.deepEqual(numbers(s.parents), [2]);
  assert.deepEqual(s.root, { name: "a" });
});

test("a pull request from a fork has no count of commits behind: GitHub compares a branch of the base's repository", () => {
  // A branch of the same name as the fork's head is not the head.
  const json = answer({ pullRequest: { isCrossRepository: true }, baseRef: { name: "main", compare: { behindBy: 40 } }, parent: { nodes: [] } });
  assert.deepEqual(parseStack(json, 3, "main").base, { name: "main" });
});
