import assert from "node:assert/strict";
import { test } from "node:test";
import { parseIds } from "../src/daemon/ops/sub-issue.ts";
import { parseSubIssues } from "../src/daemon/ops/sub-issues.ts";

test("the parent and sub-issues keep their repositories, and only links to github.com", () => {
  const node = (number: number, url: string, more: Record<string, unknown> = {}) => ({ number, title: `t${number}`, state: "OPEN", url, repository: { nameWithOwner: "4rtoflow/GashoPlugins" }, ...more });
  const json = JSON.stringify({
    data: {
      repository: {
        issue: {
          parent: node(12, "https://github.com/4rtoflow/GashoPlugins/issues/12"),
          subIssues: {
            nodes: [
              node(13, "https://github.com/4rtoflow/GashoPlugins/issues/13", { state: "CLOSED", stateReason: "NOT_PLANNED" }),
              node(5, "https://github.com/4rtoflow/Gasho/issues/5", { state: "CLOSED", stateReason: "COMPLETED", repository: { nameWithOwner: "4rtoflow/Gasho" } }),
              node(14, "javascript:alert(1)"),
            ],
          },
        },
      },
    },
  });
  assert.deepEqual(parseSubIssues(json), {
    parent: { repo: "4rtoflow/GashoPlugins", number: 12, title: "t12", state: "open", url: "https://github.com/4rtoflow/GashoPlugins/issues/12" },
    children: [
      { repo: "4rtoflow/GashoPlugins", number: 13, title: "t13", state: "closed", stateReason: "not_planned", url: "https://github.com/4rtoflow/GashoPlugins/issues/13" },
      { repo: "4rtoflow/Gasho", number: 5, title: "t5", state: "closed", stateReason: "completed", url: "https://github.com/4rtoflow/Gasho/issues/5" },
    ],
  });
});

test("a pull request is refused as a parent or a sub-issue, with its number", () => {
  const side = { repo: "4rtoflow/GashoPlugins", number: 30 };
  const ids = (child: unknown) => JSON.stringify({ data: { parent: { issueOrPullRequest: { __typename: "Issue", id: "I_1" } }, child: { issueOrPullRequest: child } } });
  assert.deepEqual(parseIds(ids({ __typename: "Issue", id: "I_2" }), side, { ...side, number: 31 }), { parent: "I_1", child: "I_2" });
  assert.throws(() => parseIds(ids({ __typename: "PullRequest" }), side, { ...side, number: 35 }), /#35 は Pull request です/);
});
