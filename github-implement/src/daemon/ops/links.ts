// What a pull request closes when it is merged, and what closes an issue (GitHub's "Development"): { repo, kind,
// number, fresh? } → ItemLinks. For a pull request, also the repository's open issues it could be linked to. One
// GraphQL query (1 or 2 points), read when the screen shows, not in the background.
import type { CloseReason, GitHubKind } from "../../types.ts";
import { gh, itemRead } from "../core.ts";
import { closeReason, httpsUrl, kindArg, num, numberArg, repoArg, str } from "../gh.ts";
import type { Op } from "../op.ts";

export interface LinkedIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  stateReason?: CloseReason;
  url: string;
  /** owner/name, when it is of another repository. */
  repo?: string;
  /** Linked by hand: it can be taken off (link-issue). */
  manual: boolean;
  /** Linked by the body or a commit ("Closes #12"): it comes off only by changing them. */
  keyword: boolean;
}

export interface LinkedPull {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  draft?: boolean;
  url: string;
  repo?: string;
}

export interface ItemLinks {
  /** Pull requests: the issues it closes. */
  closes?: LinkedIssue[];
  /** Issues: the pull requests that close it, closed ones too. */
  closedBy?: LinkedPull[];
  /** Pull requests: the repository's open issues, the latest updated first, to link. */
  open?: { number: number; title: string }[];
}

const MAX = 25;
const ISSUE = "number title state stateReason url repository { nameWithOwner }";
const PULL = "number title state isDraft url repository { nameWithOwner }";

/** The links of one item. The issues a pull request closes are read twice, by hand and by keyword, to tell them apart. */
export function linksQueryArgs(repo: string, kind: GitHubKind, number: number): string[] {
  const [owner, name] = repo.split("/") as [string, string];
  const item =
    kind === "pulls"
      ? `... on PullRequest { manual: closingIssuesReferences(first: ${MAX}, userLinkedOnly: true) { nodes { ${ISSUE} } } keyword: closingIssuesReferences(first: ${MAX}, excludeUserLinked: true) { nodes { ${ISSUE} } } }`
      : `... on Issue { closedByPullRequestsReferences(first: ${MAX}, includeClosedPrs: true) { nodes { ${PULL} } } }`;
  const open = kind === "pulls" ? " open: issues(first: 100, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { number title } }" : "";
  const query = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issueOrPullRequest(number: $number) { ${item} }${open} } }`;
  return ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`];
}

const nodesOf = (v: unknown): Record<string, unknown>[] => ((v as { nodes?: unknown } | null | undefined)?.nodes as Record<string, unknown>[] | undefined)?.filter((n) => n !== null && typeof n === "object") ?? [];

/** The fields every link has, or undefined when it is not one; `repo` only when it is of another repository. */
function linkOf(n: Record<string, unknown>, repo: string): { number: number; title: string; url: string; repo?: string } | undefined {
  const number = num(n.number);
  const title = str(n.title);
  const url = httpsUrl(n.url);
  if (number === undefined || title === undefined || !url?.startsWith("https://github.com/")) return undefined;
  const of = str((n.repository as { nameWithOwner?: unknown } | null | undefined)?.nameWithOwner);
  return { number, title, url, ...(of && of.toLowerCase() !== repo.toLowerCase() ? { repo: of } : {}) };
}

export function parseLinks(json: string, repo: string, kind: GitHubKind): ItemLinks {
  const data = (JSON.parse(json) as { data?: { repository?: Record<string, unknown> | null } }).data?.repository ?? {};
  const item = (data.issueOrPullRequest ?? {}) as Record<string, unknown>;
  if (kind === "issues") {
    const closedBy = nodesOf(item.closedByPullRequestsReferences).flatMap((n): LinkedPull[] => {
      const link = linkOf(n, repo);
      if (!link) return [];
      const state = str(n.state)?.toUpperCase();
      return [{ ...link, state: state === "MERGED" ? "merged" : state === "CLOSED" ? "closed" : "open", ...(n.isDraft === true ? { draft: true } : {}) }];
    });
    return { closedBy };
  }
  const closes = new Map<string, LinkedIssue>();
  for (const [field, how] of [["manual", "manual"], ["keyword", "keyword"]] as const) {
    for (const n of nodesOf(item[field])) {
      const link = linkOf(n, repo);
      if (!link) continue;
      const key = `${link.repo ?? ""}#${link.number}`;
      const reason = closeReason(n.stateReason);
      const was = closes.get(key) ?? {
        ...link,
        state: str(n.state)?.toUpperCase() === "CLOSED" ? "closed" : "open",
        ...(reason ? { stateReason: reason } : {}),
        manual: false,
        keyword: false,
      };
      closes.set(key, { ...was, [how]: true });
    }
  }
  const open = nodesOf(data.open).flatMap((n) => {
    const number = num(n.number);
    const title = str(n.title);
    return number !== undefined && title !== undefined ? [{ number, title }] : [];
  });
  return { closes: [...closes.values()].sort((a, b) => (a.repo ?? "").localeCompare(b.repo ?? "") || a.number - b.number), open };
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const kind = kindArg(p.kind);
    const number = numberArg(p.number);
    return gh(
      `read the links of #${number}`,
      async () => parseLinks((await itemRead(ctx, repo, number, p)(linksQueryArgs(repo, kind, number))).stdout, repo, kind),
      ctx,
    );
  },
} satisfies Op;
