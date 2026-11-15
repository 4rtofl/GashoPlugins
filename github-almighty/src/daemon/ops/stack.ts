// A pull request's place in a stack of pull requests, and how far it is behind its base:
// { repo, number, head, base, fresh? } → PullStack. The screen gives the head and base it read (GitHubItemDetail), so
// that it is one GraphQL query (1 point), read when a pull request's screen shows, not in the background.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh, maxAge, readAllowingNotFound } from "../core.ts";
import { branchArg, num, numberArg, repoArg, str } from "../gh.ts";
import type { Op } from "../op.ts";

/** A pull request of the stack. */
export interface StackPull {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  draft?: boolean;
  url: string;
  head: string;
  base: string;
}

export interface PullStack {
  defaultBranch?: string;
  /** Where the parents start: the default branch, or a branch with no pull request of its own (or past the parents read). */
  root: { name: string; gone?: boolean };
  /** From the root's side: each one's head is the base of the next, and the last one's head is this one's base. */
  parents: StackPull[];
  /** The open pull requests whose base is this one's head. */
  children: StackPull[];
  /** This one's base. gone: the branch was deleted. behindBy: the commits of the base its head does not have. */
  base: { name: string; gone?: boolean; behindBy?: number };
  /** When the parent was merged: the branch its commits went into, where this one's base belongs now (when it is there). */
  mergedInto?: string;
}

/** Parents read above the one whose head is the base; past them the stack shows the branch they start from. */
const DEPTH = 5;
const PULL = "number title state isDraft url headRefName baseRefName isCrossRepository";

/**
 * Each parent's own parents, through its base branch (null when it was deleted). A ref's associatedPullRequests are
 * those whose head it is; two of them, so that an open one is found beside a merged one.
 */
function above(depth: number): string {
  const more = depth > 0 ? ` associatedPullRequests(first: 2, states: [OPEN, MERGED], orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ${PULL} ${above(depth - 1)} } }` : "";
  return `baseRef { name${more} }`;
}

export function stackQueryArgs(repo: string, number: number, head: string, base: string): string[] {
  const [owner, name] = repo.split("/") as [string, string];
  const query =
    "query($owner: String!, $name: String!, $number: Int!, $head: String!, $base: String!, $baseRef: String!) { repository(owner: $owner, name: $name) { " +
    "defaultBranchRef { name } " +
    "pullRequest(number: $number) { isCrossRepository } " +
    // The base asked about, not the pull request's base now: a read with the base before a change keeps to that base.
    "baseRef: ref(qualifiedName: $baseRef) { name compare(headRef: $head) { behindBy } } " +
    `children: pullRequests(baseRefName: $head, states: OPEN, first: 20, orderBy: {field: CREATED_AT, direction: ASC}) { nodes { ${PULL} } } ` +
    // Any state, so that a parent that was merged (and its branch deleted) is found too.
    `parent: pullRequests(headRefName: $base, first: 3, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ${PULL} ${above(DEPTH)} } } } }`;
  return ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`, "-f", `head=${head}`, "-f", `base=${base}`, "-f", `baseRef=refs/heads/${base}`];
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | undefined => (typeof v === "object" && v !== null ? (v as Raw) : undefined);
/** A connection's nodes; undefined when it was not read (past the parents asked for) or its branch is gone. */
const nodesOf = (connection: unknown): Raw[] | undefined => {
  const nodes = obj(connection)?.nodes;
  return Array.isArray(nodes) ? nodes.flatMap<Raw>((n: unknown) => obj(n) ?? []) : undefined;
};

function pull(r: Raw): StackPull | undefined {
  const number = num(r.number);
  const title = str(r.title);
  const url = str(r.url);
  const head = str(r.headRefName);
  const base = str(r.baseRefName);
  if (number === undefined || title === undefined || !url?.startsWith("https://github.com/") || !head || !base) return undefined;
  const state = str(r.state)?.toUpperCase();
  return { number, title, state: state === "MERGED" ? "merged" : state === "CLOSED" ? "closed" : "open", ...(r.isDraft === true ? { draft: true } : {}), url, head, base };
}

/** The pull request of this repository whose head is `branch`: an open one, else the latest merged one. */
function parentOf(nodes: Raw[], branch: string, seen: Set<number>): { pull: StackPull; raw: Raw } | undefined {
  const found = nodes.flatMap((raw) => {
    const p = raw.isCrossRepository === true ? undefined : pull(raw);
    return p && p.head === branch && p.state !== "closed" && !seen.has(p.number) ? [{ pull: p, raw }] : [];
  });
  return found.find((f) => f.pull.state === "open") ?? found[0];
}

/** The output of stackQueryArgs. `number` and `base` are those it was asked about. */
export function parseStack(json: string, number: number, base: string): PullStack {
  const repo = obj(obj(obj(JSON.parse(json))?.data)?.repository) ?? {};
  const defaultBranch = str(obj(repo.defaultBranchRef)?.name);
  const self = obj(repo.pullRequest) ?? {};
  const baseRef = obj(repo.baseRef);
  const behindBy = num(obj(baseRef?.compare)?.behindBy);

  const parents: StackPull[] = [];
  const seen = new Set([number]);
  let branch = base;
  let gone = !baseRef;
  let nodes = nodesOf(repo.parent);
  while (branch !== defaultBranch && nodes) {
    const found = parentOf(nodes, branch, seen);
    if (!found) break;
    parents.unshift(found.pull);
    seen.add(found.pull.number);
    branch = found.pull.base;
    const ref = obj(found.raw.baseRef);
    gone = !ref;
    nodes = nodesOf(ref?.associatedPullRequests);
  }

  // Past the parents that were merged: to the head of the nearest one still open, or to the root.
  let open = parents.length - 1;
  while (open >= 0 && parents[open]?.state === "merged") open--;
  const mergedInto = open === parents.length - 1 ? undefined : open >= 0 ? parents[open]?.head : gone ? undefined : branch;

  return {
    ...(defaultBranch ? { defaultBranch } : {}),
    root: { name: branch, ...(gone ? { gone: true } : {}) },
    parents,
    // A head in a fork is not a branch of this repository, whatever its name.
    children: self.isCrossRepository === true ? [] : (nodesOf(repo.children) ?? []).flatMap((n) => pull(n) ?? []),
    base: { name: base, ...(!baseRef ? { gone: true } : {}), ...(behindBy !== undefined ? { behindBy } : {}) },
    ...(mergedInto ? { mergedInto } : {}),
  };
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    const head = branchArg(p.head);
    const base = branchArg(p.base);
    if (!head || !base) throw new PluginError("Pull request のブランチの指定が正しくありません。");
    return gh(
      `read the stack of #${number}`,
      // A head GitHub cannot compare (deleted, or in a fork) is NOT_FOUND.
      async () => parseStack(await readAllowingNotFound(ctx, stackQueryArgs(repo, number, head, base), { repo, maxAgeSeconds: maxAge(p) }), number, base),
      ctx,
    );
  },
} satisfies Op;
