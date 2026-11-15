import assert from "node:assert/strict";
import { test } from "node:test";
import { setArgs, valueArg } from "../src/daemon/ops/project.ts";
import { lacksProjectScope, parseProjects } from "../src/daemon/ops/projects.ts";

const ref = (id: string, more: Record<string, unknown> = {}) => ({ id, number: 1, title: id, url: `https://github.com/orgs/o/projects/${id}`, closed: false, viewerCanUpdate: true, ...more });

test("a project's fields carry their values, and the choices leave out the projects it is in, closed ones and ones gh may not change", () => {
  const json = JSON.stringify({
    data: {
      viewer: { projectsV2: { nodes: [ref("mine"), ref("in")] } },
      repository: {
        issueOrPullRequest: {
          id: "I_1",
          projectItems: {
            nodes: [
              {
                id: "PVTI_1",
                project: {
                  ...ref("in"),
                  fields: {
                    nodes: [
                      { id: "F_title", name: "Title", dataType: "TITLE" },
                      { id: "F_status", name: "Status", dataType: "SINGLE_SELECT", options: [{ id: "o1", name: "Todo", color: "GREEN" }] },
                      { id: "F_due", name: "期限", dataType: "DATE" },
                      { id: "F_size", name: "見積", dataType: "NUMBER" },
                    ],
                  },
                },
                fieldValues: {
                  nodes: [
                    { __typename: "ProjectV2ItemFieldTextValue", text: "題", field: { id: "F_title" } },
                    { __typename: "ProjectV2ItemFieldSingleSelectValue", optionId: "o1", name: "Todo", field: { id: "F_status" } },
                    { __typename: "ProjectV2ItemFieldDateValue", date: "2026-11-20", field: { id: "F_due" } },
                  ],
                },
              },
            ],
          },
        },
        owner: { projectsV2: { nodes: [ref("mine"), ref("closed", { closed: true }), ref("read-only", { viewerCanUpdate: false })] } },
        projectsV2: { nodes: [ref("linked")] },
      },
    },
  });
  const read = parseProjects(json);
  assert.equal(read?.contentId, "I_1");
  assert.deepEqual(read?.items[0]?.fields, [
    { id: "F_status", name: "Status", type: "single_select", options: [{ id: "o1", name: "Todo", color: "GREEN" }], value: { singleSelectOptionId: "o1" }, valueName: "Todo" },
    { id: "F_due", name: "期限", type: "date", value: { date: "2026-11-20" } },
    { id: "F_size", name: "見積", type: "number" },
  ]);
  assert.deepEqual(
    read?.choices.map((c) => c.id),
    ["mine", "linked"],
  );
});

test("a number goes into the mutation itself and texts go as variables, typed as GitHub takes them", () => {
  const args = setArgs("PVT_1", "PVTI_1", [
    { fieldId: "F_size", value: valueArg({ number: 3.5 }) },
    { fieldId: "F_due", value: valueArg({ date: "2026-11-20" }) },
    { fieldId: "F_memo", value: valueArg({ text: "-- $x" }) },
  ]);
  const query = args[args.indexOf("-f") + 1] ?? "";
  // gh sends a variable with a fraction as a string, which GitHub refuses for a Float.
  assert.match(query, /fieldId: \$f0, value: \{number: 3\.5\}/);
  assert.match(query, /\$v1: Date!.*\$v2: String!/);
  assert.ok(args.includes("v2=-- $x"));
  assert.throws(() => valueArg({ number: Number.NaN }));
  assert.throws(() => valueArg({ text: "a", number: 1 }));
});

test("gh failing for want of the scope project is told apart from other failures", () => {
  const stderr =
    "gh: Your token has not been granted the required scopes to execute this query. The 'projectItems' field requires one of the following scopes: ['read:project'], but your token has only been granted the: ['gist', 'read:org', 'repo'] scopes. Please modify your token's scopes at: https://github.com/settings/tokens.";
  assert.ok(lacksProjectScope({ stderr, code: 1 }));
  assert.ok(!lacksProjectScope({ stderr: stderr.replace("['read:project']", "['read:org']"), code: 1 }));
  assert.ok(!lacksProjectScope({ stderr: "gh: Could not resolve to an issue or pull request with the number of 9.", code: 1 }));
});
