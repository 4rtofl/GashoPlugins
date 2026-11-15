// The changes the conversation shows between the comments: labels and assignees put on and taken off, closed,
// reopened and merged: { repo, number, fresh? } → GitHubEvent[], oldest first. One GraphQL query (1 point), read when
// the conversation shows, not in the background.
import type { GitHubEvent } from "../../types.ts";
import { gh, maxAge } from "../core.ts";
import { labelColor, login, numberArg, repoArg, str } from "../gh.ts";
import type { Op } from "../op.ts";

const TYPES = ["LABELED_EVENT", "UNLABELED_EVENT", "ASSIGNED_EVENT", "UNASSIGNED_EVENT", "CLOSED_EVENT", "REOPENED_EVENT"];
const LABEL = "createdAt actor { login } label { name color }";
const ASSIGNEE = "createdAt actor { login } assignee { ... on Actor { login } }";
const NODES =
  `__typename ... on LabeledEvent { ${LABEL} } ... on UnlabeledEvent { ${LABEL} } ... on AssignedEvent { ${ASSIGNEE} } ` +
  `... on UnassignedEvent { ${ASSIGNEE} } ... on ClosedEvent { createdAt actor { login } stateReason } ... on ReopenedEvent { createdAt actor { login } }`;

/** The latest 100 changes. Issues and pull requests name their kinds of timeline items apart, and only pull requests merge. */
export function eventsQueryArgs(repo: string, number: number): string[] {
  const [owner, name] = repo.split("/") as [string, string];
  const query =
    "query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issueOrPullRequest(number: $number) { " +
    `... on Issue { timelineItems(last: 100, itemTypes: [${TYPES.join(", ")}]) { nodes { ${NODES} } } } ` +
    `... on PullRequest { timelineItems(last: 100, itemTypes: [${[...TYPES, "MERGED_EVENT"].join(", ")}]) { nodes { ${NODES} ... on MergedEvent { createdAt actor { login } } } } } } } }`;
  return ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`];
}

const TYPE: Record<string, GitHubEvent["type"]> = {
  LabeledEvent: "labeled",
  UnlabeledEvent: "unlabeled",
  AssignedEvent: "assigned",
  UnassignedEvent: "unassigned",
  ClosedEvent: "closed",
  ReopenedEvent: "reopened",
  MergedEvent: "merged",
};

export function parseEvents(json: string): GitHubEvent[] {
  const data = JSON.parse(json) as { data?: { repository?: { issueOrPullRequest?: { timelineItems?: { nodes?: unknown[] } } | null } | null } };
  const nodes = data.data?.repository?.issueOrPullRequest?.timelineItems?.nodes ?? [];
  const events = nodes.flatMap((raw): GitHubEvent[] => {
    const n = (raw ?? {}) as Record<string, unknown>;
    const type = TYPE[str(n.__typename) ?? ""];
    const at = str(n.createdAt);
    if (!type || !at) return [];
    const actor = login(n.actor);
    const e: GitHubEvent = { type, at, ...(actor ? { actor } : {}) };
    if (type === "labeled" || type === "unlabeled") {
      const name = str((n.label as Record<string, unknown> | null)?.name);
      if (!name) return [];
      const color = labelColor((n.label as Record<string, unknown>).color);
      e.label = { name, ...(color ? { color } : {}) };
    }
    if (type === "assigned" || type === "unassigned") {
      const who = login(n.assignee);
      if (who) e.assignee = who;
    }
    const reason = str(n.stateReason)?.toUpperCase();
    if (type === "closed" && reason === "NOT_PLANNED") e.stateReason = "not_planned";
    if (type === "closed" && reason === "COMPLETED") e.stateReason = "completed";
    return [e];
  });
  // A pull request that is merged is closed at the same moment: the merge says it.
  const merged = new Set(events.filter((e) => e.type === "merged").map((e) => e.at));
  return events.filter((e) => !(e.type === "closed" && merged.has(e.at)));
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    return gh(`read the events of #${number}`, async () => parseEvents((await ctx.github.read(eventsQueryArgs(repo, number), { repo, maxAgeSeconds: maxAge(p) })).stdout), ctx);
  },
} satisfies Op;
