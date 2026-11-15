import assert from "node:assert/strict";
import { test } from "node:test";
import { linksQueryArgs, parseLinks } from "../src/daemon/ops/links.ts";

const issue = (number: number, repo = "o/r") => ({ number, title: `t${number}`, state: "OPEN", stateReason: null, url: `https://github.com/${repo}/issues/${number}`, repository: { nameWithOwner: repo } });

test("a pull request's issues are told apart by how they are linked, as only a link made by hand comes off", () => {
  const query = linksQueryArgs("o/r", "pulls", 5).find((a) => a.startsWith("query="));
  assert.ok(query?.includes("userLinkedOnly: true") && query.includes("excludeUserLinked: true") && query.includes(" open: issues("));
  const json = JSON.stringify({
    data: {
      repository: {
        issueOrPullRequest: { manual: { nodes: [issue(1), issue(2)] }, keyword: { nodes: [issue(2), issue(3), issue(4, "x/y")] } },
        open: { nodes: [{ number: 9, title: "nine" }] },
      },
    },
  });
  const links = parseLinks(json, "o/r", "pulls");
  assert.deepEqual(
    links.closes?.map((i) => [i.repo ?? "", i.number, i.manual, i.keyword]),
    [
      ["", 1, true, false],
      ["", 2, true, true],
      ["", 3, false, true],
      ["x/y", 4, false, true],
    ],
  );
  assert.deepEqual(links.open, [{ number: 9, title: "nine" }]);
});

test("an issue's read asks only for the pull requests that close it", () => {
  const query = linksQueryArgs("o/r", "issues", 5).find((a) => a.startsWith("query="));
  assert.ok(query?.includes("closedByPullRequestsReferences") && !query.includes("closingIssuesReferences") && !query.includes(" open: "));
  const json = JSON.stringify({
    data: { repository: { issueOrPullRequest: { closedByPullRequestsReferences: { nodes: [{ number: 7, title: "p", state: "OPEN", isDraft: true, url: "https://github.com/o/r/pull/7", repository: { nameWithOwner: "O/R" } }] } } } },
  });
  assert.deepEqual(parseLinks(json, "o/r", "issues"), { closedBy: [{ number: 7, title: "p", url: "https://github.com/o/r/pull/7", state: "open", draft: true }] });
});
