// What the form for a new pull request of a worktree's branch starts from: { repo, branch, base?, fresh? } → NewPull.
// Whether the branch is on GitHub (gh only makes a pull request of a pushed branch), the branches it can go into, the
// repository's pull request templates, and how the branch stands against the base (the default branch when no base is
// given). When the call names a session in the worktree, also its HEAD against the branch on GitHub: the commits not
// pushed yet. One GraphQL query, one more per 100 branches past the first 100 (BRANCH_PAGES), and one for the
// comparison when the branch is on GitHub.
import type { DaemonContext } from "@gasho/plugin-sdk/daemon";
import type { NewPull } from "../../types.ts";
import { gh, maxAge, type Ctx } from "../core.ts";
import { branchArg, num, repoArg, str } from "../gh.ts";
import type { Op } from "../op.ts";

declare module "../../types.ts" {
  /** What the form for a new pull request starts from (ops/new-pull.ts). */
  interface NewPull {
    defaultBranch?: string;
    /** What it can go into: the default branch first, then the branches by their latest commits, newest first (100 at most), never the branch itself. */
    branches: string[];
    /** The latest commit of the branch on GitHub; absent when it is not pushed. */
    headOid?: string;
    /** The pull request templates of the default branch, the default one first. */
    templates: { filename: string; body: string }[];
    /** The branch against the base; absent when either is not on GitHub. */
    compare?: {
      base: string;
      ahead: number;
      behind: number;
      /** The first lines of the commits it would bring, oldest first (100 at most). */
      commits: string[];
    };
    /** The worktree's HEAD against the branch on GitHub, when the call names a session in the worktree. */
    local?: {
      /** Commits only the worktree has; absent when it does not have GitHub's latest commit (not fetched). */
      ahead?: number;
      /** GitHub has commits the worktree does not. */
      behind: boolean;
    };
  }
}

const OID = /^[0-9a-f]{40}$/;

/**
 * Branches are read 100 a query, this many queries at most (1 point each). GitHub orders refs by commit date only for
 * tags, so all of them are read by name and put in order here; past 1000, the newest of the first 1000 by name.
 */
export const BRANCH_PAGES = 10;
const CANDIDATES_MAX = 100;
const refsOf = (after: string) => `refs(refPrefix: "refs/heads/", first: 100${after}, orderBy: {field: ALPHABETICAL, direction: ASC}) { pageInfo { hasNextPage endCursor } nodes { name target { ... on Commit { committedDate } } } }`;

export function newPullArgs(repo: string, branch: string): string[] {
  const [owner, name] = repo.split("/") as [string, string];
  const query =
    "query($owner: String!, $name: String!, $head: String!) { repository(owner: $owner, name: $name) { " +
    `defaultBranchRef { name } head: ref(qualifiedName: $head) { target { oid } } pullRequestTemplates { filename body } ${refsOf("")} } }`;
  return ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-f", `head=refs/heads/${branch}`];
}

/** The branches after `after` (the endCursor of the page before). */
export function branchPageArgs(repo: string, after: string): string[] {
  const [owner, name] = repo.split("/") as [string, string];
  const query = `query($owner: String!, $name: String!, $after: String!) { repository(owner: $owner, name: $name) { ${refsOf(", after: $after")} } }`;
  return ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-f", `after=${after}`];
}

/** A branch and when its latest commit was made ("" when GitHub did not say). */
export interface BranchRef {
  name: string;
  at: string;
}

/** The branches of the output of newPullArgs or branchPageArgs, and the cursor of the next page when there is one. */
export function parseBranchPage(json: string): { refs: BranchRef[]; next?: string } {
  const refs = repository(json)?.refs as { nodes?: unknown[]; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } } | null | undefined;
  const nodes = (refs?.nodes ?? []).flatMap((n): BranchRef[] => {
    const r = (n ?? {}) as Record<string, unknown>;
    const name = str(r.name);
    return name ? [{ name, at: str((r.target as Record<string, unknown> | null)?.committedDate) ?? "" }] : [];
  });
  const next = refs?.pageInfo?.hasNextPage === true ? str(refs.pageInfo.endCursor) : undefined;
  return { refs: nodes, ...(next ? { next } : {}) };
}

/** The commits `branch` has and `base` does not. Only for a branch on GitHub: GitHub fails the query for one it does not have. */
export function compareArgs(repo: string, base: string, branch: string): string[] {
  const [owner, name] = repo.split("/") as [string, string];
  const query =
    "query($owner: String!, $name: String!, $base: String!, $head: String!) { repository(owner: $owner, name: $name) { " +
    "ref(qualifiedName: $base) { compare(headRef: $head) { aheadBy behindBy commits(first: 100) { nodes { messageHeadline } } } } } }";
  return ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-f", `base=refs/heads/${base}`, "-f", `head=${branch}`];
}

type Repository = Record<string, unknown> | null | undefined;
const repository = (json: string): Repository => (JSON.parse(json) as { data?: { repository?: Repository } }).data?.repository;

/** GitHub's default template is pull_request_template.md (in the root, .github/ or docs/); more are in a folder of that name. */
const DEFAULT_TEMPLATE = /^pull_request_template\.md$/i;

/** The output of newPullArgs; `refs`: every branch read, of it and of the pages after it. */
export function parseNewPull(json: string, branch: string, refs: BranchRef[] = parseBranchPage(json).refs): NewPull {
  const r = repository(json) ?? {};
  const defaultBranch = str((r.defaultBranchRef as Record<string, unknown> | null)?.name);
  const oid = str(((r.head as Record<string, unknown> | null)?.target as Record<string, unknown> | null)?.oid);
  // ISO 8601 in UTC, as GitHub gives them, sort as text.
  const names = [...refs].sort((a, b) => b.at.localeCompare(a.at)).map((b) => b.name);
  const branches = [...new Set([...(defaultBranch ? [defaultBranch] : []), ...names])].filter((b) => b !== branch).slice(0, CANDIDATES_MAX);
  const templates = (Array.isArray(r.pullRequestTemplates) ? r.pullRequestTemplates : [])
    .flatMap((t: Record<string, unknown> | null) => {
      const filename = str(t?.filename);
      const body = str(t?.body);
      return filename && body !== undefined ? [{ filename, body }] : [];
    })
    .sort((a, b) => Number(DEFAULT_TEMPLATE.test(b.filename)) - Number(DEFAULT_TEMPLATE.test(a.filename)));
  return { ...(defaultBranch ? { defaultBranch } : {}), branches, ...(oid && OID.test(oid) ? { headOid: oid } : {}), templates };
}

export function parseCompare(json: string, base: string): NewPull["compare"] {
  const c = ((repository(json)?.ref as Record<string, unknown> | null)?.compare ?? undefined) as Record<string, unknown> | undefined;
  const ahead = num(c?.aheadBy);
  const behind = num(c?.behindBy);
  if (ahead === undefined || behind === undefined) return undefined;
  const commits = (((c?.commits as { nodes?: unknown[] } | null)?.nodes ?? []) as unknown[]).map((n) => str((n as Record<string, unknown> | null)?.messageHeadline) ?? "");
  return { base, ahead, behind, commits };
}

/** The worktree's HEAD against `oid`, the branch's latest commit on GitHub, with git in the folder gasho-daemon gives for the session. */
export async function localState(ctx: Pick<DaemonContext, "session" | "exec" | "log">, branch: string, oid: string): Promise<NewPull["local"]> {
  let dir: string;
  try {
    const folder = ctx.session?.repo();
    if (!folder) return undefined;
    dir = folder.dir;
  } catch {
    return undefined;
  }
  const git = (args: string[]) => ctx.exec("git", ["-C", dir, ...args], { timeoutMs: 10_000 });
  try {
    // The session's own branch comes from its transcript, which a session that has said nothing yet does not have.
    const checkedOut = await git(["symbolic-ref", "--short", "HEAD"]).catch(() => undefined);
    if (checkedOut?.stdout.trim() !== branch) return undefined;
    const head = (await git(["rev-parse", "HEAD"])).stdout.trim();
    if (head === oid) return { ahead: 0, behind: false };
    // Left: only GitHub's commit has them; right: only HEAD. git fails when the worktree does not have GitHub's commit.
    const counts = await git(["rev-list", "--left-right", "--count", `${oid}...HEAD`]).catch(() => undefined);
    if (!counts) return { behind: true };
    const [left, right] = counts.stdout.trim().split(/\s+/).map(Number);
    return { ahead: right ?? 0, behind: (left ?? 0) > 0 };
  } catch (e) {
    ctx.log("could not read the worktree's HEAD", e);
    return undefined;
  }
}

async function read(ctx: Ctx, repo: string, args: string[], maxAgeSeconds: number): Promise<string> {
  return (await ctx.github.read(args, { repo, maxAgeSeconds })).stdout;
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const branch = branchArg(p.branch);
    if (!branch) return { branches: [], templates: [] } satisfies NewPull;
    const given = branchArg(p.base);
    const age = maxAge(p);
    const first = await gh("read the branches", () => read(ctx, repo, newPullArgs(repo, branch), age), ctx);
    let page = parseBranchPage(first);
    const refs = [...page.refs];
    for (let n = 1; page.next && n < BRANCH_PAGES; n++) {
      const after = page.next;
      page = parseBranchPage(await gh("read the branches", () => read(ctx, repo, branchPageArgs(repo, after), age), ctx));
      refs.push(...page.refs);
    }
    const pull = parseNewPull(first, branch, refs);
    const base = given ?? pull.defaultBranch;
    const oid = pull.headOid;
    if (!oid) return pull;
    const [compare, local] = await Promise.all([
      base && base !== branch ? gh(`compare ${branch} with ${base}`, async () => parseCompare(await read(ctx, repo, compareArgs(repo, base, branch), age), base), ctx) : undefined,
      localState(ctx, branch, oid),
    ]);
    return { ...pull, ...(compare ? { compare } : {}), ...(local ? { local } : {}) } satisfies NewPull;
  },
} satisfies Op;
