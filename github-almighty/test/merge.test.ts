import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeArgs } from "../src/daemon/ops/merge.ts";
import { mergeableArgs, parseMergeable } from "../src/daemon/ops/mergeable.ts";

const OID = "a".repeat(40);

function answer(pr: Record<string, unknown>, repo: Record<string, unknown> = {}): string {
  return JSON.stringify({
    data: {
      repository: {
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: false,
        autoMergeAllowed: true,
        deleteBranchOnMerge: false,
        viewerDefaultMergeMethod: "SQUASH",
        ...repo,
        pullRequest: { isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", reviewDecision: null, canBeRebased: true, isCrossRepository: false, headRefOid: OID, baseRefName: "main", headRef: { name: "feat/25-merge" }, ...pr },
      },
    },
  });
}

const checks = (...nodes: Record<string, unknown>[]) => ({ commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes } } } }] } });

test("a pull request that can be merged has no blockers, and the methods are those the repository allows", () => {
  const m = parseMergeable(answer({}));
  assert.deepEqual(m?.methods, ["merge", "squash"]);
  assert.equal(m?.preferred, "squash");
  assert.deepEqual(m?.blockers, []);
  assert.equal(m?.head, "feat/25-merge");
  assert.equal(m?.headOid, OID);
  // The last method used is offered first only when it is still allowed.
  assert.equal(parseMergeable(answer({}, { viewerDefaultMergeMethod: "REBASE" }))?.preferred, undefined);
  // A branch of a fork is not this repository's to delete.
  assert.equal(parseMergeable(answer({ isCrossRepository: true }))?.head, undefined);
});

test("only required checks keep it from being merged; the others are told apart", () => {
  const m = parseMergeable(
    answer({
      mergeStateStatus: "BLOCKED",
      ...checks(
        { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "FAILURE", isRequired: true },
        { __typename: "CheckRun", name: "skipped", status: "COMPLETED", conclusion: "SKIPPED", isRequired: true },
        { __typename: "StatusContext", context: "ci/deploy", state: "PENDING", isRequired: true },
        { __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "FAILURE", isRequired: false },
      ),
    }),
  );
  assert.deepEqual(m?.blockers, [{ kind: "checks", failing: ["build"], pending: ["ci/deploy"] }]);
  assert.deepEqual(m?.unstable, ["lint"]);
});

test("a draft, a conflict, reviews and an old head are each a reason", () => {
  const kinds = (pr: Record<string, unknown>) => parseMergeable(answer(pr))?.blockers.map((b) => b.kind);
  assert.deepEqual(kinds({ isDraft: true }), ["draft"]);
  assert.deepEqual(kinds({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }), ["conflict"]);
  assert.deepEqual(parseMergeable(answer({ mergeStateStatus: "BLOCKED", reviewDecision: "CHANGES_REQUESTED" }))?.blockers, [{ kind: "review", decision: "changes_requested" }]);
  // Without a rule that requires reviews, GitHub merges a pull request with changes requested.
  assert.deepEqual(kinds({ reviewDecision: "CHANGES_REQUESTED" }), []);
  assert.deepEqual(kinds({ mergeStateStatus: "BEHIND" }), ["behind"]);
  assert.deepEqual(kinds({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }), ["unknown"]);
  // Blocked by something it does not name (signed commits, resolved conversations, …).
  assert.deepEqual(kinds({ mergeStateStatus: "BLOCKED" }), ["rule"]);
  assert.equal(parseMergeable(JSON.stringify({ data: { repository: { pullRequest: null } } })), undefined);
});

test("auto-merge as GitHub has it", () => {
  const m = parseMergeable(answer({ viewerCanDisableAutoMerge: true, autoMergeRequest: { mergeMethod: "SQUASH", enabledAt: "2026-11-15T00:00:00Z", enabledBy: { login: "octocat" } } }));
  assert.deepEqual(m?.auto, { allowed: true, canEnable: false, canDisable: true, on: { method: "squash", by: "octocat", at: "2026-11-15T00:00:00Z" } });
});

test("the gh arguments of a merge: the method, the branch only for a merge now, and the head it was shown", () => {
  assert.deepEqual(mergeArgs("o/r", 3, { action: "merge", method: "squash", deleteBranch: true, head: OID }), ["pr", "merge", "3", "--repo", "o/r", "--squash", "--delete-branch", `--match-head-commit=${OID}`]);
  assert.deepEqual(mergeArgs("o/r", 3, { action: "merge", method: "rebase" }), ["pr", "merge", "3", "--repo", "o/r", "--rebase"]);
  assert.deepEqual(mergeArgs("o/r", 3, { action: "auto", method: "merge" }), ["pr", "merge", "3", "--repo", "o/r", "--auto", "--merge"]);
  assert.deepEqual(mergeArgs("o/r", 3, { action: "cancel-auto" }), ["pr", "merge", "3", "--repo", "o/r", "--disable-auto"]);
  // The number goes in as a typed variable (-F), as isRequired(pullRequestNumber:) takes an Int.
  assert.ok(mergeableArgs("o/r", 3).includes("number=3"));
});
