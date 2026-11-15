// The card over a #number in the conversation, as GitHub's hovercard: { repo, number, fresh? } → ItemCard, or null
// when GitHub does not have it. One GraphQL query (1 point).
import type { ItemSummary } from "../../types.ts";
import { gh, maxAge, readAllowingNotFound } from "../core.ts";
import { labelColor, login, numberArg, repoArg, str, summary } from "../gh.ts";
import type { Op } from "../op.ts";

export interface ItemCard extends ItemSummary {
  /** ISO 8601 */
  createdAt: string;
  /** Issues closed: whether as done or as not planned. */
  stateReason?: "completed" | "not_planned";
  /** The start of the body as plain text on one line; "" when it has none. */
  excerpt: string;
  labels: { name: string; color?: string }[];
  /** How gh's login is related to it: an assignee, its author, or the author of one of its latest 100 comments. */
  assigned: boolean;
  authored: boolean;
  commented: boolean;
}

/** More than a card shows in its 3 lines. */
const EXCERPT_MAX = 300;
const FIELDS = "number title state url createdAt bodyText viewerDidAuthor labels(first: 20) { nodes { name color } } assignees(first: 20) { nodes { login } } comments(last: 100) { nodes { viewerDidAuthor } }";

export function cardQueryArgs(repo: string, number: number): string[] {
  const [owner, name] = repo.split("/") as [string, string];
  const query = `query($owner: String!, $name: String!, $number: Int!) { viewer { login } repository(owner: $owner, name: $name) { issueOrPullRequest(number: $number) { __typename ... on Issue { ${FIELDS} stateReason } ... on PullRequest { ${FIELDS} isDraft } } } }`;
  return ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`];
}

const nodesOf = (v: unknown): Record<string, unknown>[] => ((v as { nodes?: unknown } | null | undefined)?.nodes as Record<string, unknown>[] | undefined)?.filter((n) => n !== null && typeof n === "object") ?? [];

function excerptOf(text: string): string {
  const chars = [...text.replace(/\s+/g, " ").trim()];
  return chars.length > EXCERPT_MAX ? `${chars.slice(0, EXCERPT_MAX).join("")}…` : chars.join("");
}

export function parseCard(json: string): ItemCard | null {
  const data = (JSON.parse(json) as { data?: { viewer?: unknown; repository?: { issueOrPullRequest?: unknown } | null } }).data;
  const raw = data?.repository?.issueOrPullRequest;
  const item = summary(raw);
  if (!item) return null;
  const r = raw as Record<string, unknown>;
  const me = login(data?.viewer);
  const reason = str(r.stateReason)?.toUpperCase();
  return {
    ...item,
    createdAt: str(r.createdAt) ?? "",
    ...(item.state === "closed" && reason === "NOT_PLANNED" ? { stateReason: "not_planned" as const } : {}),
    ...(item.state === "closed" && reason === "COMPLETED" ? { stateReason: "completed" as const } : {}),
    excerpt: excerptOf(str(r.bodyText) ?? ""),
    labels: nodesOf(r.labels).flatMap((l) => {
      const name = str(l.name);
      const color = labelColor(l.color);
      return name ? [{ name, ...(color ? { color } : {}) }] : [];
    }),
    assigned: me !== undefined && nodesOf(r.assignees).some((a) => login(a) === me),
    authored: r.viewerDidAuthor === true,
    commented: nodesOf(r.comments).some((c) => c.viewerDidAuthor === true),
  };
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    return gh(`read the card of #${number}`, async () => parseCard(await readAllowingNotFound(ctx, cardQueryArgs(repo, number), { repo, maxAgeSeconds: maxAge(p) })), ctx);
  },
} satisfies Op;
