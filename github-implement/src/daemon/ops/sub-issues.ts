// An issue's parent and its sub-issues, which `gh issue view --json` has no fields for: { repo, number, fresh? } →
// SubIssues. One GraphQL query (1 point), read when the issue's screen shows, not in the background. GitHub lets an
// issue have 100 sub-issues, so the first 100 are all of them.
import { gh, itemRead } from "../core.ts";
import { num, numberArg, repoArg, str } from "../gh.ts";
import type { Op } from "../op.ts";

/** An issue that is the parent or a sub-issue of another; a sub-issue may be in another repository. */
export interface IssueRef {
  /** owner/name */
  repo: string;
  number: number;
  title: string;
  state: "open" | "closed";
  stateReason?: "completed" | "not_planned";
  url: string;
}

export interface SubIssues {
  parent?: IssueRef;
  /** In GitHub's order. */
  children: IssueRef[];
}

const REF = "number title state stateReason url repository { nameWithOwner }";

export function subIssuesQueryArgs(repo: string, number: number): string[] {
  const [owner, name] = repo.split("/") as [string, string];
  const query = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { parent { ${REF} } subIssues(first: 100) { nodes { ${REF} } } } } }`;
  return ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`];
}

function ref(raw: unknown): IssueRef | undefined {
  const r = (raw ?? {}) as Record<string, unknown>;
  const number = num(r.number);
  const title = str(r.title);
  const url = str(r.url);
  const repo = str((r.repository as Record<string, unknown> | null | undefined)?.nameWithOwner);
  // Shown as links in browsers: only pages on github.com.
  if (number === undefined || title === undefined || !repo || !url?.startsWith("https://github.com/")) return undefined;
  const closed = str(r.state)?.toUpperCase() === "CLOSED";
  return {
    repo,
    number,
    title,
    state: closed ? "closed" : "open",
    ...(closed && { stateReason: str(r.stateReason)?.toUpperCase() === "NOT_PLANNED" ? ("not_planned" as const) : ("completed" as const) }),
    url,
  };
}

export function parseSubIssues(json: string): SubIssues {
  const issue = (JSON.parse(json) as { data?: { repository?: { issue?: { parent?: unknown; subIssues?: { nodes?: unknown[] } } | null } | null } }).data?.repository?.issue;
  const parent = ref(issue?.parent);
  return { ...(parent && { parent }), children: (issue?.subIssues?.nodes ?? []).flatMap((n) => ref(n) ?? []) };
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    return gh(`read the sub-issues of #${number}`, async () => parseSubIssues((await itemRead(ctx, repo, number, p)(subIssuesQueryArgs(repo, number))).stdout), ctx);
  },
} satisfies Op;
