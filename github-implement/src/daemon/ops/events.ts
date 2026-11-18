// The changes the conversation shows between the comments: labels and assignees put on and taken off, closed,
// reopened and merged: { repo, number, fresh? } → GitHubEvent[], oldest first. One GraphQL query (1 point), read when
// the conversation shows, not in the background.
import type { GitHubEvent } from "../../types.ts";
import { gh, itemRead } from "../core.ts";
import { closeReason, labelColor, login, numberArg, repoArg, str } from "../gh.ts";
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

/** How far apart a merge and the close it comes with may be. */
const MERGE_CLOSE_MS = 60_000;

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
    const reason = type === "closed" ? closeReason(n.stateReason) : undefined;
    if (reason) e.stateReason = reason;
    return [e];
  });
  // A merge closes the pull request too, up to a second before or after it; the merge says it. A merged one is never
  // reopened after, so the close of the merge is one near it that no reopen comes after.
  const merges = events.filter((e) => e.type === "merged").map((e) => Date.parse(e.at));
  const ofMerge = (e: GitHubEvent, i: number) =>
    e.type === "closed" && merges.some((m) => Math.abs(Date.parse(e.at) - m) <= MERGE_CLOSE_MS) && !events.slice(i + 1).some((later) => later.type === "reopened");
  return events.filter((e, i) => !ofMerge(e, i));
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    return gh(`read the events of #${number}`, async () => parseEvents((await itemRead(ctx, repo, number, p)(eventsQueryArgs(repo, number))).stdout), ctx);
  },
} satisfies Op;
