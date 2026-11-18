// The people who can be assigned (and asked for reviews) found by `query`, for the pickers when the repository has more
// of them than "meta" reads (RepoMeta.assignableMore): { repo, query } → FoundAssignable. GitHub finds those whose login
// or name starts with it, so the pickers also narrow what "meta" read. One GraphQL query (1 point).
import { gh, keepSeconds } from "../core.ts";
import { login, num, repoArg, textArg } from "../gh.ts";
import type { Op } from "../op.ts";

export interface FoundAssignable {
  logins: string[];
  /** GitHub found more than these. */
  more: boolean;
}

const FIRST = 50;

export function assignableQueryArgs(repo: string, query: string): string[] {
  const [owner, name] = repo.split("/") as [string, string];
  const q =
    "query($owner: String!, $name: String!, $filter: String!) { repository(owner: $owner, name: $name) { " +
    `assignableUsers(query: $filter, first: ${FIRST}) { totalCount nodes { login } } } }`;
  return ["api", "graphql", "-f", `query=${q}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-f", `filter=${query}`];
}

export function parseAssignable(json: string): FoundAssignable {
  const found = (JSON.parse(json) as { data?: { repository?: { assignableUsers?: { totalCount?: unknown; nodes?: unknown[] } | null } | null } }).data?.repository?.assignableUsers;
  const logins = (found?.nodes ?? []).flatMap((u) => login(u) ?? []);
  return { logins, more: (num(found?.totalCount) ?? 0) > logins.length };
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const query = textArg(p.query, "名前", 100).trim();
    return gh("search the people who can be assigned", async () => parseAssignable((await ctx.github.read(assignableQueryArgs(repo, query), { repo, maxAgeSeconds: keepSeconds() })).stdout), ctx);
  },
} satisfies Op;
