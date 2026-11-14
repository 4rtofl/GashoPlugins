// Makes an issue a sub-issue of another (action "add"), or takes it off its parent (action "remove"):
// { repo, action, parent, child, parentRepo?, childRepo? }. Both are numbers in `repo` unless their own repository is
// given: a sub-issue may be in another one. GitHub's mutations take node IDs, which one query reads first.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh, KEEP_MAX_SECONDS } from "../core.ts";
import { numberArg, repoArg, str } from "../gh.ts";
import type { Op } from "../op.ts";

interface Side {
  repo: string;
  number: number;
}

/** The node IDs of both, in one query. A pull request has no ID there: it cannot be a parent or a sub-issue. */
export function idsQueryArgs(parent: Side, child: Side): string[] {
  const [po, pn] = parent.repo.split("/") as [string, string];
  const [co, cn] = child.repo.split("/") as [string, string];
  const query =
    "query($po: String!, $pn: String!, $pi: Int!, $co: String!, $cn: String!, $ci: Int!) { " +
    "parent: repository(owner: $po, name: $pn) { issueOrPullRequest(number: $pi) { __typename ... on Issue { id } } } " +
    "child: repository(owner: $co, name: $cn) { issueOrPullRequest(number: $ci) { __typename ... on Issue { id } } } }";
  return ["api", "graphql", "-f", `query=${query}`, "-f", `po=${po}`, "-f", `pn=${pn}`, "-F", `pi=${parent.number}`, "-f", `co=${co}`, "-f", `cn=${cn}`, "-F", `ci=${child.number}`];
}

export function parseIds(json: string, parent: Side, child: Side): { parent: string; child: string } {
  const data = (JSON.parse(json) as { data?: Record<string, { issueOrPullRequest?: { __typename?: unknown; id?: unknown } | null } | null> }).data ?? {};
  const id = (key: "parent" | "child", side: Side): string => {
    const node = data[key]?.issueOrPullRequest;
    if (node?.__typename === "PullRequest") throw new PluginError(`#${side.number} は Pull request です。親と sub-issue にできるのは Issue だけです。`);
    const v = str(node?.id);
    if (!v) throw new PluginError(`${side.repo} に #${side.number} はありません。`);
    return v;
  };
  return { parent: id("parent", parent), child: id("child", child) };
}

export function subIssueArgs(action: "add" | "remove", ids: { parent: string; child: string }): string[] {
  const field = action === "add" ? "addSubIssue" : "removeSubIssue";
  const query = `mutation($parent: ID!, $child: ID!) { ${field}(input: {issueId: $parent, subIssueId: $child}) { issue { number } } }`;
  return ["api", "graphql", "-f", `query=${query}`, "-f", `parent=${ids.parent}`, "-f", `child=${ids.child}`];
}

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    if (p.action !== "add" && p.action !== "remove") throw new PluginError("足すか外すかの指定が正しくありません。");
    const action = p.action;
    const parent = { repo: p.parentRepo === undefined ? repo : repoArg(p.parentRepo), number: numberArg(p.parent) };
    const child = { repo: p.childRepo === undefined ? repo : repoArg(p.childRepo), number: numberArg(p.child) };
    if (parent.repo.toLowerCase() === child.repo.toLowerCase() && parent.number === child.number) throw new PluginError("自分を自分の sub-issue にはできません。");
    // Node IDs never change, so the kept answer can be old.
    const json = (await gh(`read the IDs of #${parent.number} and #${child.number}`, () => ctx.github.read(idsQueryArgs(parent, child), { repo, maxAgeSeconds: KEEP_MAX_SECONDS }), ctx)).stdout;
    const ids = parseIds(json, parent, child);
    await gh(`${action} sub-issue #${child.number} of #${parent.number}`, () => ctx.github.write(subIssueArgs(action, ids), { repo }), ctx);
    return { ok: true };
  },
} satisfies Op;
